// 代码还原（2026-10-31 加，配合 code-snapshot.mjs）
//
// node task/restore-code.mjs --list
// node task/restore-code.mjs --dry
// node task/restore-code.mjs --yes
// node task/restore-code.mjs --yes --only scheduler.js
// node task/restore-code.mjs --yes --commit <sha>   # 从某个提交里取，而不是当前工作区
//
// 规则：
//   1. 先备份将被覆盖的现版本到 %USERPROFILE%\whale-restore-safety\<stamp>\
//   2. 只覆盖「快照里有的」文件，不会删你没在快照里的东西
//   3. --commit 用 git worktree 取历史版本，取完删掉临时 worktree
//   4. 还原完提示要重载哪些插件（它不改运行时，只改盘上的文件）

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const HOME = process.env.USERPROFILE || os.homedir()
const DSH = path.join(HOME, '.dsh')
const WORK = path.join(DSH, 'whale-work')
const REPO = path.join(HOME, 'whale-backup')
const NODE_MODULES = path.join(DSH, 'profiles', 'desktop', 'node_modules')
const GIT = path.join(HOME, 'AppData', 'Local', 'Programs', 'PortableGit', 'bin', 'git.exe')
const SAFETY_ROOT = path.join(HOME, 'whale-restore-safety')

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}

const dryRun = has('--dry') || !has('--yes')
const only = val('--only')
const commit = val('--commit')
const listOnly = has('--list')

function stamp() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(/[: ]/g, '').slice(0, 14)
}

function git(args, cwd = REPO) {
  return execFileSync(GIT, ['-C', cwd, ...args], { encoding: 'utf8' })
}

// 取快照根目录：当前工作区 or 某次提交的 worktree
function snapshotRoot() {
  if (!commit) {
    const root = path.join(REPO, 'code')
    if (!fs.existsSync(root)) throw new Error(`快照不存在：${root}（先跑 node task/code-snapshot.mjs）`)
    return { root, cleanup: () => {} }
  }
  const tmp = path.join(os.tmpdir(), `whale-code-${commit}-${Date.now()}`)
  git(['worktree', 'add', '--detach', tmp, commit])
  return { root: path.join(tmp, 'code'), cleanup: () => git(['worktree', 'remove', '--force', tmp]) }
}

function walk(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, base, out)
    else out.push(path.relative(base, p))
  }
  return out
}

function targetFor(rel) {
  // plugins/<name>/... → ~/.dsh/whale-work/<name>/...
  if (rel.startsWith(`plugins${path.sep}`)) {
    const parts = rel.split(path.sep)
    return path.join(WORK, ...parts.slice(1))
  }
  // patches/<pkg>/<rel> → node_modules/<pkg>/<rel>
  if (rel.startsWith(`patches${path.sep}`)) {
    const parts = rel.split(path.sep)
    return path.join(NODE_MODULES, ...parts.slice(1))
  }
  return null
}

function main() {
  const { root, cleanup } = snapshotRoot()
  try {
    const files = walk(root).filter((r) => {
      if (r === 'MANIFEST.json' || r === 'README.md') return false
      if (!targetFor(r)) return false
      if (only && !r.includes(only)) return false
      return true
    })

    if (!files.length) {
      console.log('没有匹配的文件')
      return
    }

    if (listOnly) {
      for (const rel of files) console.log(`${rel}\n  → ${targetFor(rel)}`)
      console.log(`\n共 ${files.length} 个`)
      return
    }

    if (dryRun) {
      console.log(`[dry] 会还原 ${files.length} 个文件${commit ? `（提交 ${commit}）` : ''}：`)
      for (const rel of files) console.log(`  ${rel}\n    → ${targetFor(rel)}`)
      console.log('\n确认无误加 --yes 真还原')
      return
    }

    const safety = path.join(SAFETY_ROOT, stamp())
    let copied = 0
    let backedUp = 0
    for (const rel of files) {
      const src = path.join(root, rel)
      const dst = targetFor(rel)
      if (fs.existsSync(dst)) {
        const bak = path.join(safety, rel)
        fs.mkdirSync(path.dirname(bak), { recursive: true })
        fs.copyFileSync(dst, bak)
        backedUp++
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.copyFileSync(src, dst)
      copied++
    }

    console.log(`已还原 ${copied} 个文件（其中 ${backedUp} 个旧版本存到 ${safety}）`)
    console.log('\n下一步：重载相关插件（--only 只还原了一个文件也一样）')
    console.log('  plugin_manager set_plugin  include:dsh-bili-whale  false → true')
    console.log('  plugin_manager set_plugin  include:dsh-onebot-qq  false → true')
    console.log('  plugin_manager set_plugin  include:whale-relay    false → true')
  } finally {
    cleanup()
  }
}

main()
