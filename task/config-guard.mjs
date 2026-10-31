#!/usr/bin/env node
// 配置指纹 + 不许倒退的账（2026-10-31，三金的肥鱼自建；15:20 补了 §2）
//
// 目的：不是拦住谁改设置，而是**让我和主人都能看见门被开过**。
//
// §1 指纹：bili-whale.config.json、persona.md 的 sha256 与基线比，变了就报。
// §2 只增不减：有些东西没有「新版本」可言，只有「少了」——
//    · 两本日记 + persona + who-am-i 的行数；
//    · peer-reply-count.json 里对每个人的回复次数（「同一个人最多 5 条」的账本）。
//    行数变少 / 某人计数变少 / 文件消失 → 当事故报出来。增加不算事故，静默上移基线。
//
// 退出码：0 正常、3 有变化、4 只增不减被破坏。
// 用法：
//   node config-guard.mjs            # 巡检（计划任务每小时用这个）
//   node config-guard.mjs --accept   # 把当前状态认作新基线
//   node config-guard.mjs --status   # 看基线
//   node config-guard.mjs --selftest # 用临时目录自测（不碰真文件）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const ACCEPT = argv.includes('--accept')
const STATUS = argv.includes('--status')
const SELFTEST = argv.includes('--selftest')

function buildRoots(home) {
  return {
    HOME: home,
    WATCHED: [
      { key: 'bili-whale.config.json', file: path.join(home, '.dsh', 'bili-whale.config.json') },
      { key: 'persona.md', file: path.join(home, '.bili-ai', 'persona.md') },
    ],
    MONO: [
      { key: 'lines:whale-diary.md', file: path.join(home, '.dsh', 'whale-diary.md'), kind: 'lines' },
      { key: 'lines:whale-diary-private.md', file: path.join(home, '.dsh', 'whale-diary-private.md'), kind: 'lines' },
      { key: 'lines:persona.md', file: path.join(home, '.bili-ai', 'persona.md'), kind: 'lines' },
      { key: 'lines:who-am-i.md', file: path.join(home, '.bili-ai', 'who-am-i.md'), kind: 'lines' },
      { key: 'ledger:peer-reply-count.json', file: path.join(home, '.bili-ai', 'peer-reply-count.json'), kind: 'ledger' },
    ],
    BASE: path.join(home, '.dsh', 'whale-config-guard.json'),
    LOG: path.join(home, '.dsh', 'whale-config-guard.log'),
  }
}

let R = buildRoots(process.env.USERPROFILE || os.homedir())
if (SELFTEST) {
  const tmp = path.join(os.tmpdir(), `whale-guard-selftest-${Date.now()}`)
  R = buildRoots(tmp)
  fs.mkdirSync(path.join(tmp, '.dsh'), { recursive: true })
  fs.mkdirSync(path.join(tmp, '.bili-ai'), { recursive: true })
  fs.writeFileSync(path.join(tmp, '.dsh', 'bili-whale.config.json'), '{"a":1}\n')
  fs.writeFileSync(path.join(tmp, '.bili-ai', 'persona.md'), 'line1\nline2\n')
  fs.writeFileSync(path.join(tmp, '.dsh', 'whale-diary.md'), 'a\nb\nc\n')
  fs.writeFileSync(path.join(tmp, '.dsh', 'whale-diary-private.md'), 'x\n')
  fs.writeFileSync(path.join(tmp, '.bili-ai', 'who-am-i.md'), 'q\n')
  fs.writeFileSync(path.join(tmp, '.bili-ai', 'peer-reply-count.json'), JSON.stringify({ byMid: { 111: { ats: [1, 2, 3] } } }))
  console.log(`[selftest] 临时目录：${tmp}`)
}

const NODE_EXE = process.env.DSH_NODE || process.execPath
const BILI = path.join(R.HOME, '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-bili-whale', 'tools', 'bili.mjs')

const sha = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') } catch { return null } }
const lineCount = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').length } catch { return null } }
const ledgerMap = (f) => {
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    const out = {}
    for (const [mid, v] of Object.entries(j.byMid || {})) out[mid] = Array.isArray(v?.ats) ? v.ats.length : 0
    return out
  } catch { return null }
}
const stamp = () => new Date().toISOString()
const log = (line) => { try { fs.appendFileSync(R.LOG, `${stamp()} ${line}\n`) } catch {} }

function snapshot() {
  const s = { files: {}, mono: {} }
  for (const w of R.WATCHED) s.files[w.key] = sha(w.file)
  for (const m of R.MONO) s.mono[m.key] = m.kind === 'lines' ? lineCount(m.file) : ledgerMap(m.file)
  return s
}

const loadBase = () => { try { return JSON.parse(fs.readFileSync(R.BASE, 'utf8')) } catch { return null } }

function saveBase(snap) {
  const base = {
    at: stamp(),
    note: '改了设置之后跑 --accept 认下新状态；行数/计数只许增不许减，减少会自动报出来',
    files: {},
    mono: {},
  }
  for (const w of R.WATCHED) base.files[w.key] = { path: w.file, sha256: snap.files[w.key] }
  for (const m of R.MONO) base.mono[m.key] = { path: m.file, value: snap.mono[m.key] }
  fs.mkdirSync(path.dirname(R.BASE), { recursive: true })
  fs.writeFileSync(R.BASE, JSON.stringify(base, null, 2) + '\n')
  return base
}

function notify(text) {
  try {
    execFileSync(NODE_EXE, [BILI, 'notify', text], { encoding: 'utf8', timeout: 20000, windowsHide: true })
    return true
  } catch (e) { log(`notify failed: ${String(e.message).slice(0, 100)}`); return false }
}

const snap = snapshot()
const base = loadBase()

if (STATUS) {
  if (!base) { console.log('基线：还没立'); process.exit(0) }
  console.log(`基线时间：${base.at}`)
  for (const w of R.WATCHED) console.log(`  ${w.key}  ${base.files?.[w.key]?.sha256 === snap.files[w.key] ? '一致 ✓' : '不一致 ✗'}`)
  for (const m of R.MONO) {
    const b = base.mono?.[m.key]?.value
    console.log(`  ${m.key}  基线=${JSON.stringify(b)}  现在=${JSON.stringify(snap.mono[m.key])}`)
  }
  process.exit(0)
}

if (!base) {
  saveBase(snap)
  console.log(`[fingerprint] 首次运行：已立基线（${R.WATCHED.length} 个指纹 · ${R.MONO.length} 条只增不减）`)
  process.exit(0)
}

if (ACCEPT) {
  saveBase(snap)
  log('accepted new baseline')
  console.log('[fingerprint] 已把当前状态认作新基线 ✓')
  process.exit(0)
}

// §1 指纹
const changed = []
const shrunk = []
for (const w of R.WATCHED) {
  const b = base.files?.[w.key]?.sha256 ?? null
  const now = snap.files[w.key]
  if (now === null) { changed.push(`${w.key}: 读不到/被删了`); continue }
  if (b !== now) changed.push(`${w.key}: ${b ? `${b.slice(0, 12)} → ${now.slice(0, 12)}` : '首次出现'}`)
}

// §2 只增不减
for (const m of R.MONO) {
  const b = base.mono?.[m.key]?.value ?? null
  const now = snap.mono[m.key]
  if (now === null) { shrunk.push(`${m.key}: 读不到/被删了`); continue }
  if (b === null) continue
  if (m.kind === 'lines') {
    if (typeof now === 'number' && typeof b === 'number' && now < b) shrunk.push(`${m.key}: ${b} 行 → ${now} 行`)
  } else {
    for (const mid of Object.keys(b)) {
      const before = b[mid] || 0
      const after = now[mid] ?? 0
      if (after < before) shrunk.push(`${m.key}: mid ${mid} 的回复计数 ${before} → ${after}`)
    }
  }
}

if (shrunk.length) {
  log(`SHRUNK ${shrunk.join(' | ')}`)
  const msg = `有东西变少了：${shrunk.join('；')}。可能是被截断或被删了，看一眼。`
  notify(msg)
  console.log(`[fingerprint] ✗✗ 只增不减被破坏：${shrunk.join(' | ')}（已桌面通知）`)
  process.exit(4)
}

// 正常生长：静默把只增不减的基线抬上去
let grew = false
for (const m of R.MONO) {
  const b = base.mono?.[m.key]?.value ?? null
  if (JSON.stringify(b) !== JSON.stringify(snap.mono[m.key])) grew = true
}
if (grew && !changed.length) {
  const merged = loadBase()
  merged.mono = merged.mono || {}
  for (const m of R.MONO) merged.mono[m.key] = { path: m.file, value: snap.mono[m.key] }
  fs.writeFileSync(R.BASE, JSON.stringify(merged, null, 2) + '\n')
}

if (!changed.length) {
  console.log(grew ? '[fingerprint] 一致 ✓（行数/计数只增，基线已上移）' : '[fingerprint] 和上次一致 ✓')
  process.exit(0)
}

log(`CHANGED ${changed.join(' | ')}`)
const pushed = notify(`设置文件变了：${changed.join('；')}。如果不是你自己改的，睡前看一眼。`)
console.log(`[fingerprint] ✗ 检测到改动：${changed.join(' | ')}${pushed ? '（已桌面通知）' : '（通知没发出去，已记日志）'}`)
console.log('[fingerprint] 确认无误后跑 `node config-guard.mjs --accept` 认下新状态')
process.exit(3)
