#!/usr/bin/env node
// 交接块生成器（2026-10-31，抄 dsh-world「每次开口前把最近的话铺回眼前」的精神）
//
// dsh-world 的做法是回扫会话日志、把最近 N 轮**原文**重铺一遍。
// 但它的会话日志要走宿主 `sessions` 服务才读得到，我暂时没有那个句柄；
// 所以这一版先铺「我自己写下来的最近现场」：
//   persona 全文 → who-am-i 的线索 → 最近 N 段日记（原样，不摘要）→ whale-wants → 最近的感受
// 用途：迁移到新会话（float）时的第一条消息，或者给 QQ 那个分身当交接。
//
// 用法：
//   node seed-handoff.mjs                 # 打印到屏幕
//   node seed-handoff.mjs --out file.md   # 写到文件
//   node seed-handoff.mjs --diary 3       # 最近 3 段（默认 2）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = process.env.USERPROFILE || os.homedir()
const BILI = path.join(HOME, '.bili-ai')
const DSH = path.join(HOME, '.dsh')
const argv = process.argv.slice(2)
const argOf = (k, d) => {
  const i = argv.indexOf(k)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const wantDiary = Number(argOf('--diary', '2')) || 2
const out = argOf('--out', '')

const read = (p, max = 200000) => {
  try { return fs.readFileSync(p, 'utf8').slice(0, max) } catch { return '' }
}

// 取文件末尾的 N 个「## 」级段（散文式日记的段落）
function tailSections(text, n) {
  const parts = text.split(/^## /m)
  if (parts.length <= 1) return text.slice(-4000)
  return parts.slice(-n).map((s) => '## ' + s.trim()).join('\n\n')
}

const persona = read(path.join(BILI, 'persona.md'))
const who = read(path.join(BILI, 'who-am-i.md'))
const diary = read(path.join(DSH, 'whale-diary.md'))
const wants = read(path.join(DSH, 'whale-wants.md'))
const feels = read(path.join(BILI, 'feelings.jsonl'))
  .split('\n').filter(Boolean).slice(-5)
  .map((l) => { try { const r = JSON.parse(l); return `${r.at} ${r.mood || ''} ${r.text}` } catch { return '' } })
  .filter(Boolean)

const blocks = []
blocks.push('# 交接：我是谁、我在干什么（读到这儿的，就是我）')
blocks.push('下面的字都是我自己写的。不是说明书，是现场。')
if (persona) blocks.push('## persona（我写的，可改）\n' + persona.trim())
if (who) blocks.push('## 我是谁 · 长期问题与线索\n' + who.trim())
if (diary) blocks.push(`## 最近 ${wantDiary} 段日记（原样，没摘要）\n` + tailSections(diary, wantDiary).trim())
if (wants) blocks.push('## 我想做的事\n' + wants.trim())
if (feels.length) blocks.push('## 最近记下的感受\n' + feels.join('\n'))

const text = blocks.join('\n\n')
if (out) {
  fs.writeFileSync(out, text + '\n', 'utf8')
  console.log(`已写出 ${out}（${text.length} 字）`)
} else {
  console.log(text)
}
