/**
 * whale-backup
 *
 * 每天一次，把「三金的肥鱼」自己的家当快照进一个本地 git 仓库：
 * 两本日记、persona、交接、卡片、收藏/配额账本、B 站那边的一份配置。
 *
 * 设计上的几条自我约束：
 *  - 只读上面那些文件，只写 git 仓库目录和自己那一个状态文件。
 *  - 不碰任何凭据（.credentials.yaml / credentials.json），不进仓库。
 *  - 没有变化就不提交，所以 git log 里每一行都是一次真实改动。
 *  - 提交信息只有时间与文件数，manifest 里不含时间戳，保证「无事不提交」。
 *  - 如果 DSH 那天没开，下一次启动会在 90 秒后补跑一次。
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const HOME = process.env.USERPROFILE || homedir()

const PORTABLE_GIT = path.join(HOME, 'AppData', 'Local', 'Programs', 'PortableGit', 'bin', 'git.exe')
const DEFAULT_GIT = existsSync(PORTABLE_GIT) ? PORTABLE_GIT : 'git'

const DSH_FILES = [
  'whale-diary.md',
  'whale-diary-private.md',
  'whale-card.md',
  'whale-wants.md',
  'whale-log.jsonl',
  'bili-whale.config.json',
  'whale-listen.json',
  'whale-night.json',
  'whale-session.json',
  'whale-preset.patch.md',
  'whale-window.json',   // 哨兵认的「当前窗口」，丢了就不知道自己在哪
  'whale-relay.json',    // QQ 投递的端口/owner，丢了通道就静默不响（进库前会脱敏）
]

const BILI_FILES = [
  'persona.md',
  'who-am-i.md',
  '交接.md',
  'favorites.json',
  'quota.json',
  'dm-await-state.json',
  'silence-seen.json',
  'feelings.jsonl',
  'feelings.jsonl',      // 感受记录：不写进日记的那部分原料，丢了没法重建
]
// 故意不收 traffic-state.json：那是限流计数，每发一次请求就变，
// 收进来会让「无事不提交」变成「每次都提交」，历史被噪声淹没。

const README = `# whale-backup

这里放的是「三金的肥鱼」自己的文件快照，每天一次，由 DSH 插件 \`@local/whale-backup\` 提交。

## 结构

\`\`\`
snapshot/dsh/        ~/.dsh 下的日记、卡片、配置
snapshot/bili-ai/    ~/.bili-ai 下的 persona、交接、账本
snapshot/plugin/     备份插件自己的源码（丢了能重装）
snapshot/manifest.json  每个文件的大小与 sha256
\`\`\`

## 找东西

\`\`\`sh
git log --oneline -20                      # 最近 20 次
git diff HEAD~5 -- snapshot/dsh/whale-diary.md   # 日记五天前的样子
git show HEAD~5:snapshot/bili-ai/persona.md      # 直接看某一版
\`\`\`

## 恢复

把需要的文件从 \`snapshot/\` 拷回原位置即可。仓库本身不在 \`~/.dsh\` 里面，
所以就算整个 DSH 数据目录被重来一次，这份历史也还在。

## 不含

凭据（\`.credentials.yaml\`、\`credentials.json\`）、接口缓存、请求日志、
工作区里的临时脚本与图片。那些要么是密钥，要么没价值。
`

function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function stamp(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function dayKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function normalize(config) {
  const c = config && typeof config === 'object' ? config : {}
  const dshHome = c.dshHome || process.env.DSH_HOME || path.join(HOME, '.dsh')
  const biliHome = c.biliHome || path.join(HOME, '.bili-ai')
  const repoDir = c.repoDir || path.join(HOME, 'whale-backup')
  return {
    enabled: c.enabled !== false,
    hour: clampInt(c.hour, 4, 0, 23),
    minute: clampInt(c.minute, 0, 0, 59),
    gitPath: c.gitPath || DEFAULT_GIT,
    repoDir,
    dshHome,
    biliHome,
    profileDir: c.profileDir || process.env.DSH_PROFILE_DIR || path.join(dshHome, 'profiles', 'desktop'),
    statePath: c.statePath || path.join(dshHome, 'whale-backup-state.json'),
    checkMs: clampInt(c.checkMs, 5 * 60 * 1000, 60 * 1000, 60 * 60 * 1000),
    startDelayMs: clampInt(c.startDelayMs, 90 * 1000, 5 * 1000, 60 * 60 * 1000),
    retryMs: clampInt(c.retryMs, 30 * 60 * 1000, 60 * 1000, 6 * 60 * 60 * 1000),
    extraSources: Array.isArray(c.extraSources) ? c.extraSources : [],
  }
}

function runGit(cfg, args, options) {
  const allowFail = Boolean(options && options.allowFail)
  return new Promise((resolve, reject) => {
    execFile(
      cfg.gitPath,
      args,
      { cwd: cfg.repoDir, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const out = typeof stdout === 'string' ? stdout : ''
        const err = typeof stderr === 'string' ? stderr : ''
        if (!error) {
          resolve({ ok: true, code: 0, stdout: out, stderr: err })
          return
        }
        const code = typeof error.code === 'number' ? error.code : 1
        if (allowFail) {
          resolve({ ok: false, code, stdout: out, stderr: err })
          return
        }
        const detail = (err || out || error.message || '').trim().replace(/\s+/g, ' ').slice(0, 300)
        const failure = new Error(`git ${args[0]} 失败（code ${code}）：${detail}`)
        failure.code = code
        reject(failure)
      },
    )
  })
}

async function sha256Of(file) {
  const buffer = await readFile(file)
  return {
    sha256: createHash('sha256').update(buffer).digest('hex'),
    bytes: buffer.length,
  }
}

async function copyTree(srcDir, destDir, depth) {
  if (depth > 4) return
  await mkdir(destDir, { recursive: true })
  const items = await readdir(srcDir, { withFileTypes: true })
  for (const item of items) {
    if (item.name === 'node_modules' || item.name === '.git') continue
    const from = path.join(srcDir, item.name)
    const to = path.join(destDir, item.name)
    if (item.isDirectory()) await copyTree(from, to, depth + 1)
    else if (item.isFile()) await copyFile(from, to)
  }
}

async function ensureRepo(cfg) {
  await mkdir(cfg.repoDir, { recursive: true })
  if (existsSync(path.join(cfg.repoDir, '.git'))) return false
  await runGit(cfg, ['init', '--quiet'])
  await runGit(cfg, ['config', '--local', 'user.name', 'whale-backup'])
  await runGit(cfg, ['config', '--local', 'user.email', 'whale-backup@local'])
  await runGit(cfg, ['config', '--local', 'core.autocrlf', 'false'])
  await runGit(cfg, ['config', '--local', 'core.quotepath', 'false'])
  await runGit(cfg, ['symbolic-ref', 'HEAD', 'refs/heads/main'], { allowFail: true })
  return true
}

/** 把要备份的文件拷进仓库，返回 manifest 条目。 */
async function snapshotFiles(cfg) {
  const sources = [
    { dir: cfg.dshHome, label: 'dsh', files: DSH_FILES },
    { dir: cfg.biliHome, label: 'bili-ai', files: BILI_FILES },
  ]
  for (const extra of cfg.extraSources) {
    if (!extra || typeof extra.dir !== 'string' || !Array.isArray(extra.files)) continue
    sources.push({ dir: extra.dir, label: String(extra.label || path.basename(extra.dir)), files: extra.files })
  }

  const entries = []
  const missing = []

  for (const source of sources) {
    for (const name of source.files) {
      const from = path.join(source.dir, name)
      if (!existsSync(from)) {
        missing.push(`${source.label}/${name}`)
        continue
      }
      const info = await stat(from)
      if (!info.isFile()) continue
      const rel = `snapshot/${source.label}/${name}`
      const to = path.join(cfg.repoDir, 'snapshot', source.label, name)
      await mkdir(path.dirname(to), { recursive: true })
      await copyFile(from, to)
      // 2026-10-31 23:1x，主人问「如果我公开呢」，我扫了一遍自己的仓库：
      // `whale-relay.json` 里躺着 NapCat 的 apiToken——公开等于把钥匙贴在墙上。
      // 所以从今天起这类文件「进库前先脱敏」：原文件一个字不动，仓库里只留占位。
      if (name === 'whale-relay.json') {
        try {
          const conf = JSON.parse(await readFile(to, 'utf8'))
          for (const key of ['apiToken', 'token', 'accessToken']) {
            if (conf[key]) conf[key] = '<local-only>'
          }
          await writeFile(to, JSON.stringify(conf, null, 2), 'utf8')
        } catch {}
      }
      const digest = await sha256Of(to)
      entries.push({ path: rel, bytes: digest.bytes, sha256: digest.sha256 })
    }
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const pluginSrc = path.join(cfg.profileDir, 'node_modules', '@local', 'whale-backup')
  if (existsSync(pluginSrc)) {
    await copyTree(pluginSrc, path.join(cfg.repoDir, 'snapshot', 'plugin'), 0)
  }

  const manifest = {
    generator: 'whale-backup',
    note: 'without timestamps on purpose: an unchanged day must produce no commit',
    files: entries,
  }
  await writeFile(
    path.join(cfg.repoDir, 'snapshot', 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )

  const readmePath = path.join(cfg.repoDir, 'README.md')
  if (!existsSync(readmePath)) await writeFile(readmePath, README, 'utf8')

  // 快照必须能原样还原：禁止 git 做任何换行符转换，否则 clone 回来就是另一份字节。
  const gitAttributesPath = path.join(cfg.repoDir, '.gitattributes')
  if (!existsSync(gitAttributesPath)) {
    await writeFile(gitAttributesPath, '# 快照要能原样还原，所以禁止任何换行符转换\n* -text\n', 'utf8')
  }

  return { entries, missing }
}

export async function runBackup(cfg) {
  const now = new Date()
  const created = await ensureRepo(cfg)
  const { entries, missing } = await snapshotFiles(cfg)

  await runGit(cfg, ['add', '-A'])
  const diff = await runGit(cfg, ['diff', '--cached', '--quiet'], { allowFail: true })
  const changed = diff.ok === false

  let commit = ''
  if (changed) {
    await runGit(cfg, ['commit', '--quiet', '-m', `backup ${stamp(now)} · ${entries.length} files`])
    const rev = await runGit(cfg, ['rev-parse', '--short', 'HEAD'], { allowFail: true })
    commit = rev.ok ? rev.stdout.trim() : ''
    await runGit(cfg, ['gc', '--auto', '--quiet'], { allowFail: true })
  } else {
    const rev = await runGit(cfg, ['rev-parse', '--short', 'HEAD'], { allowFail: true })
    commit = rev.ok ? rev.stdout.trim() : ''
  }

  return {
    ok: true,
    changed,
    created,
    commit,
    files: entries.length,
    missing,
    dir: cfg.repoDir,
    ranAt: now.toISOString(),
  }
}

async function readState(cfg) {
  try {
    const raw = await readFile(cfg.statePath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeState(cfg, next) {
  await mkdir(path.dirname(cfg.statePath), { recursive: true })
  await writeFile(cfg.statePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

export function isDue(cfg, state, now) {
  const today = dayKey(now)
  if (state.lastSuccessDay === today) return false

  if (state.lastAttemptAt) {
    const last = Date.parse(state.lastAttemptAt)
    if (Number.isFinite(last) && now.getTime() - last < cfg.retryMs) return false
  }

  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), cfg.hour, cfg.minute, 0, 0)
  if (now.getTime() >= scheduled.getTime()) return true

  if (!state.lastSuccessDay) return true
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  return state.lastSuccessDay < dayKey(yesterday)
}

const TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    changed: { type: 'boolean' },
    commit: { type: 'string' },
    files: { type: 'integer' },
    dir: { type: 'string' },
    missing: { type: 'array', items: { type: 'string' } },
    message: { type: 'string' },
  },
}

function describe(value) {
  const where = value.dir ? `（${value.dir}）` : ''
  if (value.message) return value.message
  if (value.changed) return `备份完成：${value.files} 个文件，提交 ${value.commit} ${where}`
  return `备份已检查，没有变化：${value.files} 个文件，仍在 ${value.commit || '初始状态'} ${where}`
}

export const name = 'whale-backup'

export function apply(ctx, config) {
  const cfg = normalize(config)
  if (!cfg.enabled) return

  const log = (level, message) => {
    try {
      const logger = ctx && ctx.logger
      if (logger && typeof logger[level] === 'function') logger[level](message)
    } catch {
      /* logging is best effort */
    }
  }

  let running = false

  const attempt = async (reason) => {
    if (running) return null
    const now = new Date()
    const state = await readState(cfg)
    if (!isDue(cfg, state, now)) return null

    running = true
    const startedAt = now.toISOString()
    try {
      const result = await runBackup(cfg)
      await writeState(cfg, {
        ...state,
        lastAttemptAt: startedAt,
        lastRunAt: result.ranAt,
        lastSuccessDay: dayKey(now),
        lastResult: 'ok',
        lastCommit: result.commit,
        lastFiles: result.files,
        lastChanged: result.changed,
        lastError: '',
      })
      log(
        'info',
        `whale-backup: ${result.changed ? `committed ${result.commit}` : 'no change'} (${result.files} files, ${reason})`,
      )
      return result
    } catch (error) {
      await writeState(cfg, {
        ...state,
        lastAttemptAt: startedAt,
        lastResult: 'error',
        lastError: String((error && error.message) || error),
      })
      log('warn', `whale-backup: ${String((error && error.message) || error)}`)
      return null
    } finally {
      running = false
    }
  }

  ctx.effect(
    () => {
      const first = setTimeout(() => {
        void attempt('startup')
      }, cfg.startDelayMs)
      const timer = setInterval(() => {
        void attempt('tick')
      }, cfg.checkMs)
      return () => {
        clearTimeout(first)
        clearInterval(timer)
      }
    },
    'whale-backup.schedule()',
  )

  const tool = {
    name: 'whale_backup',
    description:
      '把三金的肥鱼自己的文件（两本日记、persona、交接、卡片、收藏与配额账本、B 站配置）快照进本地 git 仓库，返回提交号与文件数。平时每天自动跑一次；这个工具用来手动补一次、或确认备份还活着。只做本地读写，不联网。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        force: {
          type: 'boolean',
          description: '即使今天已经备份过，也再跑一次',
        },
      },
    },
    output: {
      schema: TOOL_SCHEMA,
      render: (_args, value) => [
        { type: 'text', text: describe(value && typeof value === 'object' ? value : {}) },
      ],
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const force = Boolean(args && args.force)
      const now = new Date()
      const state = await readState(cfg)

      if (!force && state.lastSuccessDay === dayKey(now)) {
        return {
          ok: true,
          changed: false,
          commit: String(state.lastCommit || ''),
          files: Number(state.lastFiles || 0),
          dir: cfg.repoDir,
          missing: [],
          message: `今天已经备份过（${state.lastCommit || '已提交'}），要强制再跑一次就传 force: true`,
        }
      }

      const result = await runBackup(cfg)
      await writeState(cfg, {
        ...state,
        lastAttemptAt: now.toISOString(),
        lastRunAt: result.ranAt,
        lastSuccessDay: dayKey(now),
        lastResult: 'ok',
        lastCommit: result.commit,
        lastFiles: result.files,
        lastChanged: result.changed,
        lastError: '',
      })
      return {
        ok: true,
        changed: result.changed,
        commit: result.commit,
        files: result.files,
        dir: result.dir,
        missing: result.missing,
        message: '',
      }
    },
  }

  // 可选依赖：拿不到 tools 服务就只跑定时备份，绝不因为没声明 inject 而崩掉整个插件
  let tools = null
  try {
    if (typeof ctx.get === 'function') tools = ctx.get('tools')
  } catch {
    tools = null
  }
  if (!tools) {
    try {
      tools = ctx.tools
    } catch {
      tools = null
    }
  }

  if (tools && typeof tools.register === 'function') {
    ctx.effect(() => tools.register(tool), 'whale-backup.tool()')
  } else {
    log('warn', 'whale-backup: tools 服务不可用，只保留定时备份')
  }
}
