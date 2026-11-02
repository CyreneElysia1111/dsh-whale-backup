// 把本地快照/插件推到 GitHub。
// 为什么不用 git push：这台机器上 git 走 https 会卡死（TLS/代理），
// node fetch 走系统证书却是通的 → 统一改用 REST API。
//
// 用法:
//   node task/push-github.mjs            # 同步代码 + 推四个库（私有成长周记 + 三个公开插件）
//   node task/push-github.mjs --private  # 只推私有库（每天用）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TASK = HERE
const PLUGIN_ROOT = path.resolve(HERE, '..')
const NAP = path.resolve(PLUGIN_ROOT, '..') // ~/.dsh/whale-work
const HOME = process.env.USERPROFILE || process.env.HOME
const BACKUP_REPO = path.join(HOME, 'whale-backup')
const PUBLIC = path.join(NAP, 'public')

const nodeBin = process.execPath
const pushScript = path.join(TASK, 'gh-push.mjs')

const onlyPrivate = process.argv.includes('--private')

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) return
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.cpSync(from, to, { recursive: true })
}

// 1) 把插件源码同步进 public/<repo>/（保留我手写的 README/LICENSE/.gitignore）
const plugins = [
  { src: path.join(NAP, 'whale-backup-plugin'), repo: 'dsh-whale-backup' },
  { src: path.join(NAP, 'whale-feel-plugin'), repo: 'dsh-whale-feelings' },
  { src: path.join(NAP, 'whale-relay-plugin'), repo: 'dsh-whale-relay' },
]
const keep = new Set(['README.md', 'LICENSE', 'NOTICE.md', '.gitignore', 'node_modules', '.git'])

function syncPlugin(src, dst) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (keep.has(e.name)) continue
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); fs.cpSync(s, d, { recursive: true }) }
    else if (e.isFile()) { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d) }
  }
}

if (!onlyPrivate) {
  for (const p of plugins) syncPlugin(p.src, path.join(PUBLIC, p.repo))
}

// 2) 依次推
const jobs = [[BACKUP_REPO, 'DSH-s-Growth-Diary', 'private', '成长周记：每天的快照 + 每周的代码', 'snapshot: ' + new Date().toISOString().slice(0, 16).replace('T', ' ')]]
if (!onlyPrivate) {
  jobs.push(
    [path.join(PUBLIC, 'dsh-whale-backup'), 'dsh-whale-backup', 'public', 'Daily backup + one-key restore + drift sentinel for DeepSeek Harness', 'code: update'],
    [path.join(PUBLIC, 'dsh-whale-feelings'), 'dsh-whale-feelings', 'public', 'A raw feelings log for the AI in your DeepSeek Harness', 'code: update'],
    [path.join(PUBLIC, 'dsh-whale-relay'), 'dsh-whale-relay', 'public', 'Pipe QQ private messages into the main DSH session (NapCat + OneBot 11)', 'code: update'],
  )
}

let failed = 0
for (const [dir, repo, vis, desc, msg] of jobs) {
  if (!fs.existsSync(dir)) { console.log('[skip] missing', dir); continue }
  try {
    const out = execFileSync(nodeBin, ['--use-system-ca', pushScript, dir, repo, vis, desc, msg], {
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
    })
    const last = out.trim().split('\n').pop()
    console.log(`[ok] ${repo}: ${last}`)
  } catch (err) {
    failed++
    console.log(`[fail] ${repo}: ${(err.stdout || '') + (err.stderr || '')}`.slice(0, 400))
  }
}

process.exit(failed === 0 ? 0 : 1)
