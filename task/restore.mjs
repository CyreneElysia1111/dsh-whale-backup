#!/usr/bin/env node
// 一键还原：把备份仓库里某一次提交里的 16 个文件，原样写回它们活着时该在的位置。
// 用法：
//   node restore.mjs --list                    看有哪些备份点
//   node restore.mjs --commit latest --dry     先看看会动哪些文件（不动手）
//   node restore.mjs --commit latest --yes     真的还原
//   node restore.mjs --commit 1dcbc05 --yes --only persona.md,whale-diary.md
//
// 安全：动手之前，先把现在活着的文件复制一份到 %USERPROFILE%\whale-backup\pre-restore-<时间>\

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const REPO = process.env.WHALE_BACKUP_REPO || path.join(os.homedir(), 'whale-backup')
const GIT =
  process.env.WHALE_GIT ||
  'C:/Users/31279/AppData/Local/Programs/PortableGit/bin/git.exe'

const LIVE_ROOTS = {
  dsh: path.join(os.homedir(), '.dsh'),
  'bili-ai': path.join(os.homedir(), '.bili-ai'),
}

function git(args, opts = {}) {
  return execFileSync(GIT, ['-C', REPO, ...args], {
    encoding: opts.encoding ?? 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function parseArgs(argv) {
  const out = { list: false, dry: false, yes: false, commit: null, only: null }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--list') out.list = true
    else if (a === '--dry') out.dry = true
    else if (a === '--yes') out.yes = true
    else if (a === '--commit') out.commit = argv[++i]
    else if (a === '--only') out.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '-h' || a === '--help') out.help = true
    else throw new Error(`不认识的参数: ${a}`)
  }
  return out
}

function listCommits() {
  const raw = git(['log', '--format=%h\x1f%ad\x1f%s', '--date=format:%Y-%m-%d %H:%M:%S'])
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, date, subject] = line.split('\x1f')
      return { sha, date, subject }
    })
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!fs.existsSync(REPO)) throw new Error(`仓库不在: ${REPO}`)
  if (!fs.existsSync(GIT)) throw new Error(`git 不在: ${GIT}`)

  const commits = listCommits()
  if (commits.length === 0) throw new Error('仓库里还没有任何备份')

  if (args.help || args.list || !args.commit) {
    console.log('可用的备份点（最新的在最上面）：')
    for (const c of commits) console.log(`  ${c.sha}  ${c.date}  ${c.subject}`)
    if (!args.commit) {
      console.log('')
      console.log('还原：node restore.mjs --commit latest --dry   然后 --yes')
    }
    return
  }

  const target = args.commit === 'latest' ? 'HEAD' : args.commit
  const sha = git(['rev-parse', '--short', target]).trim()

  const tmp = path.join(os.tmpdir(), `whale-restore-${Date.now()}`)
  let added = false
  try {
    git(['worktree', 'add', '--detach', tmp, sha])
    added = true

    const manifestPath = path.join(tmp, 'snapshot', 'manifest.json')
    if (!fs.existsSync(manifestPath)) throw new Error(`这次备份里没有 manifest: ${sha}`)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

    const plan = []
    for (const entry of manifest.files) {
      const parts = entry.path.split('/') // snapshot/<ns>/<name>
      const ns = parts[1]
      const name = parts.slice(2).join('/')
      const root = LIVE_ROOTS[ns]
      if (!root) throw new Error(`不认识的位置: ${ns}`)
      if (args.only && !args.only.includes(name)) continue
      plan.push({
        from: path.join(tmp, ...parts),
        to: path.join(root, name),
        rel: entry.path,
        sha: entry.sha256,
      })
    }

    if (plan.length === 0) throw new Error('--only 没匹配到任何文件')

    console.log(`还原点: ${sha}`)
    console.log(`文件数: ${plan.length}`)
    for (const p of plan) {
      const exists = fs.existsSync(p.to)
      console.log(`  ${exists ? '覆盖' : '新建'}  ${p.to}`)
    }

    if (args.dry || !args.yes) {
      console.log('')
      console.log('（这是预演，什么都没动。确认要动就加 --yes）')
      return
    }

    // 先把现在活着的文件存一份，万一还原错了还能退回去
    // 放在仓库外面：仓库要只装快照，否则每次还原都会给备份添一条新提交
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safety = path.join(os.homedir(), 'whale-restore-safety', stamp)
    fs.mkdirSync(safety, { recursive: true })
    for (const p of plan) {
      if (!fs.existsSync(p.to)) continue
      const dest = path.join(safety, path.relative(os.homedir(), p.to))
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(p.to, dest)
    }
    console.log(`还原前的现状已存到: ${safety}`)

    let restored = 0
    let bad = 0
    for (const p of plan) {
      if (!fs.existsSync(p.from)) {
        console.log(`  跳过（备份里没有）  ${p.rel}`)
        bad += 1
        continue
      }
      fs.mkdirSync(path.dirname(p.to), { recursive: true })
      fs.copyFileSync(p.from, p.to)
      const got = sha256(p.to)
      if (got !== p.sha) {
        console.log(`  写回但校验不上  ${p.to}`)
        bad += 1
      } else {
        restored += 1
      }
    }

    console.log('')
    console.log(`还原完成: ${restored} 个文件校验通过${bad ? `，${bad} 个有问题` : ''}`)
    if (bad) process.exitCode = 1
  } finally {
    if (added) {
      try {
        git(['worktree', 'remove', '--force', tmp])
      } catch {
        /* 收拾不干净也不影响还原结果 */
      }
    }
  }
}

try {
  main()
} catch (error) {
  console.error(`还原失败: ${error.message}`)
  process.exitCode = 1
}
