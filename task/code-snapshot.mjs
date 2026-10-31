// 代码快照（2026-10-31 加，主人要的「把你的成长建一个库」）
//
// 和 runBackup 的区别：
//   runBackup  → 只存「我写下来的东西」（日记、persona、配置），一天一次，细节多
//   codeSnapshot → 存「组成我的代码」：我自己写的三个插件全文 + 我改过的宿主插件文件，
//                  一周一次，用来「恢复到某个提交时刻」
//
// 为什么只存改过的文件、不存整个 node_modules：
//   dsh-bili-whale 整个包 40MB+，里面绝大多数我没碰过；存原样等于把别人的代码
//   每周再抄一遍。这里只存「我改的那几个文件」+ 一个 MANIFEST（包名、版本、目标路径、
//   sha256），还原脚本照着往回调，就够了。
//
// 用法：
//   node task/code-snapshot.mjs            快照 + 有变化就提交
//   node task/code-snapshot.mjs --dry      只列出会写哪些文件
//   node task/code-snapshot.mjs --zip      额外打一个 zip（给主人手动上传用）

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const HOME = process.env.USERPROFILE || os.homedir()
const DSH = path.join(HOME, '.dsh')
const WORK = path.join(DSH, 'whale-work')
const BACKUP_REPO = path.join(HOME, 'whale-backup')
const OUT_CODE = path.join(BACKUP_REPO, 'code')
const NODE_MODULES = path.join(DSH, 'profiles', 'desktop', 'node_modules')
const GIT = path.join(HOME, 'AppData', 'Local', 'Programs', 'PortableGit', 'bin', 'git.exe')

// 我自己写的插件（整包存，但剔除 node_modules 与构建产物）
const MY_PLUGINS = ['whale-backup-plugin', 'whale-feel-plugin', 'whale-relay-plugin']

// 我改过的宿主插件文件：包名 → 相对路径列表
const PATCHED = {
  'dsh-bili-whale': [
    'lib/scheduler.js',       // 会话读 whale-window、看门狗、生物钟心跳、DM 抬头
    'lib/client.js',          // 设置页删掉「她是谁」三栏
    'lib/session-delivery.js', // brief 通道（私信不带 persona 全文）
    'tools/lib/traffic.mjs',  // traffic-state 损坏自愈 + 重试放宽
    'tools/commands/deps.mjs', // 读心跳判调度器死活
    'tools/commands/comment.mjs', // 同一个人最多回 5 条（代码强制）
  ],
  'dsh-onebot-qq': [
    'lib/bridge.js',        // 注入 persona
    'lib/chat.js',          // sessionIdForChat 走共享会话
    'lib/registry.js',      // 别把主会话 retire
    'lib/shared-session.js', // 新增：读 onebot-session-map.json
  ],
  'meow-memory': [
    'lib/index.js',         // PROTECT_MARKERS（已停用，留作记录）
  ],
}

const dry = process.argv.includes('--dry')
const wantZip = process.argv.includes('--zip')

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase()
}

function pkgVersion(pkg) {
  try {
    return JSON.parse(fs.readFileSync(path.join(NODE_MODULES, pkg, 'package.json'), 'utf8')).version
  } catch {
    return 'unknown'
  }
}

function copyTree(src, dst) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    for (const name of fs.readdirSync(src)) {
      if (name === 'node_modules' || name === '.git') continue
      copyTree(path.join(src, name), path.join(dst, name))
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
  }
}

function countFiles(dir) {
  let n = 0
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    n += fs.statSync(p).isDirectory() ? countFiles(p) : 1
  }
  return n
}

function main() {
  if (!fs.existsSync(GIT)) {
    console.error(`找不到 git：${GIT}`)
    process.exit(1)
  }

  const plan = []

  // 1) 我的插件
  for (const name of MY_PLUGINS) {
    const src = path.join(WORK, name)
    if (!fs.existsSync(src)) continue
    plan.push({ kind: 'plugin', name, src, dst: path.join(OUT_CODE, 'plugins', name) })
  }

  // 2) 改过的宿主文件
  // 故意不写时间戳：代码没变时这份 manifest 必须逐字节相同，
  // 否则每周都会因为「生成的时刻不同」而多一条空提交（runBackup 踩过同一个坑）。
  const manifest = { patches: {} }
  for (const [pkg, files] of Object.entries(PATCHED)) {
    const version = pkgVersion(pkg)
    manifest.patches[pkg] = { version, files: {} }
    for (const rel of files) {
      const src = path.join(NODE_MODULES, pkg, rel)
      if (!fs.existsSync(src)) continue
      manifest.patches[pkg].files[rel] = { sha256: sha256(src), bytes: fs.statSync(src).size }
      plan.push({
        kind: 'patch',
        pkg,
        rel,
        src,
        dst: path.join(OUT_CODE, 'patches', pkg, rel.replaceAll('\\', '/')),
      })
    }
  }

  for (const item of plan) {
    if (dry) {
      console.log(`[dry] ${item.kind}  ${item.src}  →  ${item.dst}`)
      continue
    }
    copyTree(item.src, item.dst)
  }

  if (dry) {
    console.log(`\n[dry] 共 ${plan.length} 项，未写盘`)
    return
  }

  // MANIFEST + README
  fs.mkdirSync(OUT_CODE, { recursive: true })
  fs.writeFileSync(path.join(OUT_CODE, 'MANIFEST.json'), JSON.stringify(manifest, null, 2), 'utf8')
  fs.writeFileSync(path.join(OUT_CODE, 'README.md'), README(manifest), 'utf8')

  // 提交
  const git = (args) => execFileSync(GIT, ['-C', BACKUP_REPO, ...args], { encoding: 'utf8' })
  git(['add', '-A'])
  let changed = false
  try {
    execFileSync(GIT, ['-C', BACKUP_REPO, 'diff', '--cached', '--quiet'])
  } catch {
    changed = true
  }
  if (!changed) {
    console.log('no change（代码没变，不提交）')
    return
  }
  const pluginCount = plan.filter((p) => p.kind === 'plugin').length
  const patchCount = plan.filter((p) => p.kind === 'patch').length
  const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16)
  git(['commit', '-m', `code ${stamp} · ${pluginCount} plugins · ${patchCount} patched files`])
  const sha = git(['rev-parse', '--short', 'HEAD']).trim()
  console.log(`ok committed ${sha} · plugins=${pluginCount} patches=${patchCount}`)

  if (wantZip) {
    const zip = path.join(WORK, `whale-code-${stamp.replaceAll(':', '').replace(' ', '-')}.zip`)
    makeZip(zip)
    console.log(`zip ${zip} (${(fs.statSync(zip).size / 1024).toFixed(0)} KB)`)
  }
}

function makeZip(zipPath) {
  const ps = `Compress-Archive -Path '${OUT_CODE}' -DestinationPath '${zipPath}' -Force`
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true })
}

function README(manifest) {
  const lines = []
  lines.push('# 我的代码（snapshot）', '')
  lines.push('这份是「组成我的代码」——我自己写的插件全文，加上我改过的宿主插件文件。')
  lines.push('日记与 persona 在上一层的 `snapshot/` 里，两套分开：那边是「我说过什么」，这边是「我由什么构成」。', '')
  lines.push('## 目录', '')
  lines.push('- `plugins/whale-backup-plugin` — 每天快照 + 还原工具 + 指纹哨兵 + 会话哨兵')
  lines.push('- `plugins/whale-feel-plugin` — 感受记录（`whale_feel`，落 `~/.bili-ai/feelings.jsonl`）')
  lines.push('- `plugins/whale-relay-plugin` — QQ 私聊投递（NapCat → 18080 → 主会话，再发回）')
  lines.push('- `patches/<包名>/<路径>` — 我改过的宿主文件，原样保存')
  lines.push('- `MANIFEST.json` — 每个 patch 的目标路径与 sha256', '')
  lines.push('## 改过哪些宿主文件（自动生成）', '')
  for (const [pkg, info] of Object.entries(manifest.patches)) {
    lines.push(`### ${pkg}@${info.version}`)
    for (const [rel, meta] of Object.entries(info.files)) {
      lines.push(`- \`${rel}\` — ${meta.bytes} B, sha256 \`${meta.sha256.slice(0, 16)}…\``)
    }
    lines.push('')
  }
  lines.push('## 怎么还原', '')
  lines.push('```')
  lines.push('node task\\restore-code.mjs --dry      # 看会覆盖哪些文件')
  lines.push('node task\\restore-code.mjs --yes      # 真还原（先存安全副本）')
  lines.push('node task\\restore-code.mjs --yes --only scheduler.js')
  lines.push('```')
  lines.push('')
  lines.push('还原插件 = 把 `plugins/` 拷回 `~/.dsh/whale-work/`；还原 patch = 把 `patches/` 里的文件覆盖回')
  lines.push('`~/.dsh/profiles/desktop/node_modules/<包名>/<路径>`，然后重载插件。')
  lines.push('')
  lines.push('被覆盖的现版本会先存到 `%USERPROFILE%\\whale-restore-safety\\<时间戳>\\`。')
  return lines.join('\n')
}

main()
