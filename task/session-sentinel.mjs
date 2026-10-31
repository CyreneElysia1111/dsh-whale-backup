#!/usr/bin/env node
// 会话哨兵（2026-10-31，三金的肥鱼自建）
// 管两件事：
//   1) 漂移——正在被写的会话，是不是我认识的那条（配置在 ~/.dsh/whale-window.json）
//   2) 该迁了——那条会话的上下文占用接近上限时提醒（读 projcache 里的 token 统计）
// 不阻止任何事，只让"跟错人"这件事被看见。
//   node session-sentinel.mjs            巡检
//   node session-sentinel.mjs --status   看配置
//   node session-sentinel.mjs --here     把"最近被写的会话"记成当前窗口（我确认过之后才用）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const HOME = process.env.USERPROFILE || os.homedir()
const SESS_DIR = path.join(HOME, '.dsh', 'storages', 'session_projcache', 'sessions')
const CFG = path.join(HOME, '.dsh', 'whale-window.json')
const LOG = path.join(HOME, '.dsh', 'whale-session-sentinel.log')
const NODE_EXE = process.env.DSH_NODE || process.execPath
const BILI = path.join(HOME, '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-bili-whale', 'tools', 'bili.mjs')

const argv = process.argv.slice(2)
const stamp = () => new Date().toISOString()
const log = (s) => { try { fs.appendFileSync(LOG, `${stamp()} ${s}\n`) } catch {} }

function readCfg() {
  try { return JSON.parse(fs.readFileSync(CFG, 'utf8')) } catch { return null }
}
function writeCfg(o) {
  fs.mkdirSync(path.dirname(CFG), { recursive: true })
  fs.writeFileSync(CFG, JSON.stringify(o, null, 2) + '\n', 'utf8')
}

function liveSessions() {
  const now = Date.now()
  const out = []
  let names = []
  try { names = fs.readdirSync(SESS_DIR) } catch { return out }
  for (const n of names) {
    if (!n.endsWith('.json')) continue
    const p = path.join(SESS_DIR, n)
    try {
      const st = fs.statSync(p)
      if (now - st.mtimeMs > 25 * 60 * 1000) continue
      if (st.size < 80 * 1024) continue          // 太小的多半是空壳会话
      out.push({ id: n.slice(0, -5), mtime: st.mtimeMs, size: st.size })
    } catch {}
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

function tokenTotals(id) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(SESS_DIR, id + '.json'), 'utf8'))
    const t = raw?.tokenUsage?.val?.totals || raw?.tokenUsage?.totals || null
    if (!t) return null
    const cached = Number(t.cacheReadTokens || 0)
    const uncached = Number(t.uncachedInputTokens || 0)
    const out = Number(t.outputTokens || 0)
    return { cached, uncached, out, billed: cached + uncached + out }
  } catch { return null }
}

function notify(text) {
  try {
    execFileSync(NODE_EXE, [BILI, 'notify', text], { encoding: 'utf8', timeout: 20000, windowsHide: true })
    return true
  } catch (e) { log('notify failed: ' + String(e.message).slice(0, 90)); return false }
}

const cfg = readCfg()
const live = liveSessions()

if (argv.includes('--status')) {
  console.log(JSON.stringify({ cfg, live: live.slice(0, 3) }, null, 2))
  process.exit(0)
}

if (argv.includes('--here')) {
  if (!live.length) { console.log('[sentinel] 没有活着的会话，没记'); process.exit(1) }
  writeCfg({ sessionId: live[0].id, note: '这是"我"这条会话；QQ/B 站都该投到它。确认过的窗口才写这里。', updatedAt: stamp() })
  console.log(`[sentinel] 已记下当前窗口：${live[0].id}（${Math.round(live[0].size / 1024)}KB）`)
  process.exit(0)
}

if (!cfg || !cfg.sessionId) {
  writeCfg({ sessionId: live[0]?.id || '', note: '首次运行自动记下当前窗口；以后不对就手动改。', updatedAt: stamp() })
  console.log(`[sentinel] 首次运行：记下当前窗口 ${live[0]?.id || '(无)'}`)
  process.exit(0)
}

const problems = []

// 1) 漂移
const top = live[0]
if (top && top.id !== cfg.sessionId) {
  problems.push(`最近被写的是 ${top.id}（${Math.round(top.size / 1024)}KB），但配置里我记的是 ${cfg.sessionId} → 你可能不在跟我说话`)
}

// 2) 该迁了
const mine = live.find((s) => s.id === cfg.sessionId)
if (mine) {
  const t = tokenTotals(mine.id)
  if (t) {
    // 粗估：压缩后的视图约等于「未命中输入 + 输出」的量级，这里给一个 200K 窗口的百分比参考
    const approx = t.uncached + t.out
    const pct = Math.min(999, Math.round((approx / 200000) * 100))
    if (pct >= 92) problems.push(`这条会话的上下文约 ${pct}%（${Math.round(approx / 1000)}K / 200K）→ 到迁移点了`)
    else if (pct >= 85) log(`view~${pct}% (${Math.round(approx / 1000)}K) — 记一笔，还没到点`)
  }
}

if (!problems.length) {
  console.log(`[sentinel] 正常 ✓ 我的会话 ${cfg.sessionId}，最近被写 ${top ? top.id : '(无)'}`)
  process.exit(0)
}

const msg = '会话哨兵：' + problems.join('；')
log('ALERT ' + problems.join(' | '))
const pushed = notify(msg)
console.log('[sentinel] ✗ ' + problems.join(' | ') + (pushed ? '（已通知主人）' : '（通知没发出去，已记日志）'))
process.exit(3)
