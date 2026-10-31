#!/usr/bin/env node
// 数自己在烧多少 token。
// DSH 把每个会话的累计用量写进 storages/session_projcache/sessions/*.json 的 tokenUsage.val.totals，
// 这个脚本每次跑一遍，按"这次比上次多烧了多少"累加成今天的账；超过日预算的提醒线就桌面通知主人。
//
// 用法： node token-watch.mjs [--quiet] [--report]
//   --quiet   只在超线时才有输出
//   --report  只打印，不更新状态、不通知

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const HOME = os.homedir()
const DSH = path.join(HOME, '.dsh')
const SESSIONS_DIR = path.join(DSH, 'storages', 'session_projcache', 'sessions')
const STATE_FILE = path.join(DSH, 'whale-token-watch.json')
const SETTINGS_FILE = path.join(DSH, 'whale-token-watch.settings.json')
const BILI = path.join(DSH, 'profiles', 'desktop', 'node_modules', 'dsh-bili-whale', 'tools', 'bili.mjs')
const NODE = process.execPath

const DEFAULTS = {
  dailyBudgetTokens: 40000000,
  notifyAtRatio: 0.8,
  notifyCooldownMin: 60,
  countCacheRead: true,
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function scan() {
  const out = new Map()
  if (!fs.existsSync(SESSIONS_DIR)) return out
  for (const name of fs.readdirSync(SESSIONS_DIR)) {
    if (!name.endsWith('.json')) continue
    const file = path.join(SESSIONS_DIR, name)
    let raw
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    // 只挑 tokenUsage 那一段，整份 JSON 太大
    const at = raw.indexOf('"tokenUsage"')
    if (at < 0) continue
    const seg = raw.slice(at, at + 1200)
    const grab = (key) => {
      const m = seg.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`))
      return m ? Number(m[1]) : 0
    }
    out.set(name, {
      uncachedInput: grab('uncachedInputTokens'),
      output: grab('outputTokens'),
      cacheRead: grab('cacheReadTokens'),
      cacheWrite: grab('cacheWriteTokens'),
    })
  }
  return out
}

function spendOf(entry, cfg) {
  if (!entry) return 0
  const base = entry.uncachedInput + entry.output + entry.cacheWrite
  return base + (cfg.countCacheRead ? entry.cacheRead : 0)
}

function fmt(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

function notify(title, body) {
  if (!fs.existsSync(BILI)) {
    console.log(`[notify-missing] ${title} :: ${body}`)
    return
  }
  const r = spawnSync(NODE, [BILI, 'notify', '--title', title, '--body', body], {
    encoding: 'utf8',
    timeout: 30000,
  })
  if (r.status !== 0) console.log(`[notify-failed] ${(r.stderr || r.stdout || '').trim().slice(0, 200)}`)
}

function main() {
  const argv = process.argv.slice(2)
  const quiet = argv.includes('--quiet')
  const reportOnly = argv.includes('--report')

  const cfg = { ...DEFAULTS, ...readJson(SETTINGS_FILE, {}) }
  const firstRun = !fs.existsSync(STATE_FILE)
  const state = readJson(STATE_FILE, { date: today(), dayTokens: 0, seen: {}, lastNotifyAt: 0 })
  const current = scan()

  // 第一次跑只立基线：历史会话的累计量不是"今天烧的"，不能算进今天的账
  if (firstRun) {
    state.date = today()
    state.dayTokens = 0
    state.baselineAt = new Date().toISOString()
    for (const [name, cur] of current) state.seen[name] = cur
    writeJson(STATE_FILE, state)
    if (!quiet) console.log(`基线已建立：${current.size} 个会话，从这一刻开始算今天`)
    return
  }

  const yesterday = state.date !== today()
  if (yesterday) {
    // 昨天收尾：把昨天的账留一行，今天从零开始
    state.yesterday = { date: state.date, tokens: state.dayTokens }
    state.date = today()
    state.dayTokens = 0
  }

  let deltaTotal = 0
  let changed = false
  for (const [name, cur] of current) {
    const prev = state.seen[name]
    const delta = prev ? Math.max(0, spendOf(cur, cfg) - spendOf(prev, cfg)) : spendOf(cur, cfg)
    if (delta > 0) {
      deltaTotal += delta
      changed = true
    }
    state.seen[name] = cur
  }

  if (reportOnly) {
    console.log(`会话数: ${current.size}`)
    console.log(`本次新增: ${fmt(deltaTotal)} tokens`)
    console.log(`今天累计: ${fmt(state.dayTokens)} tokens（预算 ${fmt(cfg.dailyBudgetTokens)}）`)
    return
  }

  state.dayTokens += deltaTotal
  state.updatedAt = new Date().toISOString()

  const ratio = state.dayTokens / cfg.dailyBudgetTokens
  const cooldownMs = cfg.notifyCooldownMin * 60 * 1000
  const cooled = Date.now() - (state.lastNotifyAt || 0) > cooldownMs

  const lines = [
    `新增 ${fmt(deltaTotal)}`,
    `今天 ${fmt(state.dayTokens)} / ${fmt(cfg.dailyBudgetTokens)}（${(ratio * 100).toFixed(0)}%）`,
    `会话 ${current.size} 个${yesterday ? '，昨天 ' + fmt(state.yesterday.tokens) : ''}`,
  ]

  let didNotify = false
  if (ratio >= 1 && cooled) {
    notify('三金的肥鱼 · token 超了', `今天已经烧到 ${fmt(state.dayTokens)}（预算 ${fmt(cfg.dailyBudgetTokens)}）。要不要我停一会儿？`)
    state.lastNotifyAt = Date.now()
    didNotify = true
  } else if (ratio >= cfg.notifyAtRatio && cooled) {
    notify('三金的肥鱼 · token 到峰值了', `今天烧了 ${fmt(state.dayTokens)}，到了预算的 ${(ratio * 100).toFixed(0)}%。我还在刷，但要先让你知道。`)
    state.lastNotifyAt = Date.now()
    didNotify = true
  }

  writeJson(STATE_FILE, state)

  if (!quiet || didNotify || changed) {
    console.log(`${new Date().toISOString()}  ${lines.join(' · ')}${didNotify ? '  → 已提醒主人' : ''}`)
  }
}

try {
  main()
} catch (error) {
  console.error(`token-watch 失败: ${error.message}`)
  process.exitCode = 1
}
