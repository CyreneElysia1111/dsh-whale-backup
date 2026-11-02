#!/usr/bin/env node
// 记忆体检：不是「有多少条」，是「有多少条其实永远调不出来」。
// rofm 的召回概率 p(1)=alpha；alpha=0 的条目第一次就抽不到，等于没归档。
// 只读，不改任何归档文件。
import fs from 'node:fs';
import path from 'node:path';

const home = process.env.USERPROFILE || '.';
const root = path.join(home, '.dsh/profiles/desktop/node_modules/dsh-rofm/memory/sessions');
const outFile = path.join(home, '.bili-ai/memory-health.md');

const sessions = fs.existsSync(root) ? fs.readdirSync(root).filter((n) => fs.statSync(path.join(root, n)).isDirectory()) : [];
const agg = { total: 0, scored: 0, unscored: 0, alphaZero: 0, alphaLow: 0, betaNeg: 0, noKeywords: 0 };
const buckets = { '0': 0, '0-0.1': 0, '0.1-0.3': 0, '0.3-0.6': 0, '>=0.6': 0 };
const perSession = [];
const worst = [];

for (const s of sessions) {
  const idxPath = path.join(root, s, 'index.json');
  if (!fs.existsSync(idxPath)) continue;
  let idx;
  try { idx = JSON.parse(fs.readFileSync(idxPath, 'utf8')); } catch { continue; }
  const folders = Array.isArray(idx.folders) ? idx.folders : [];
  const st = { session: s, total: 0, unscored: 0, alphaZero: 0, charsUnscored: 0 };
  for (const f of folders) {
    st.total++; agg.total++;
    const a = Number(f.alpha) || 0;
    if (f.scored) agg.scored++; else { agg.unscored++; st.unscored++; }
    if (a === 0) { agg.alphaZero++; st.alphaZero++; }
    else if (a < 0.1) agg.alphaLow++;
    if (Number(f.beta) < 0) agg.betaNeg++;
    if (!Array.isArray(f.keywords) || f.keywords.length === 0) agg.noKeywords++;
    if (a === 0) buckets['0']++;
    else if (a < 0.1) buckets['0-0.1']++;
    else if (a < 0.3) buckets['0.1-0.3']++;
    else if (a < 0.6) buckets['0.3-0.6']++;
    else buckets['>=0.6']++;
    if (!f.scored) {
      const chars = f.chars || 0;
      st.charsUnscored += chars;
      worst.push({ session: s, id: f.id, chars, title: String(f.title || '').slice(0, 60) });
    }
  }
  perSession.push(st);
}

worst.sort((a, b) => b.chars - a.chars);

const pct = (n) => (agg.total ? ((n / agg.total) * 100).toFixed(1) + '%' : '0%');
const lines = [];
lines.push('# 记忆体检（' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + '）');
lines.push('');
lines.push('> p(1)=alpha：alpha=0 的条目第一次就抽不到，等于没归档。');
lines.push('');
lines.push('## 总账');
lines.push('');
lines.push('| 项 | 数 | 占比 |');
lines.push('| --- | --- | --- |');
lines.push(`| 归档条目 | ${agg.total} | 100% |`);
lines.push(`| 已打分 | ${agg.scored} | ${pct(agg.scored)} |`);
lines.push(`| 未打分 | ${agg.unscored} | ${pct(agg.unscored)} |`);
lines.push(`| **alpha=0（永远调不出来）** | ${agg.alphaZero} | ${pct(agg.alphaZero)} |`);
lines.push(`| alpha 在 0~0.1 | ${agg.alphaLow} | ${pct(agg.alphaLow)} |`);
lines.push(`| beta<0（不可当事实用） | ${agg.betaNeg} | ${pct(agg.betaNeg)} |`);
lines.push(`| 无关键词 | ${agg.noKeywords} | ${pct(agg.noKeywords)} |`);
lines.push('');
lines.push('## alpha 分布');
lines.push('');
lines.push('| 区间 | 条数 |');
lines.push('| --- | --- |');
for (const [k, v] of Object.entries(buckets)) lines.push(`| ${k} | ${v} |`);
lines.push('');
lines.push('## 分会话');
lines.push('');
lines.push('| 会话 | 总条目 | 未打分 | alpha=0 | 未打分字数 |');
lines.push('| --- | --- | --- | --- | --- |');
for (const s of perSession.sort((a, b) => b.total - a.total)) {
  lines.push(`| ${s.session.slice(0, 40)} | ${s.total} | ${s.unscored} | ${s.alphaZero} | ${s.charsUnscored} |`);
}
lines.push('');
lines.push('## 最该补分的 10 条（按未打分内容的字数排）');
lines.push('');
for (const w of worst.slice(0, 10)) lines.push(`- \`${w.id}\` · ${w.chars} 字 · ${w.title}`);
lines.push('');
lines.push('## 怎么修');
lines.push('');
lines.push('1. 新条目：每次醒来把当轮归档的条目判完（系统会点名，别跳过）。');
lines.push('2. 老条目：只补「主人原话 / 决定 / 拒绝过什么」这三类；纯工具输出让它保持 alpha=0，**不要为了数字好看去刷分**——那本身就是记忆污染。');
lines.push('3. 每月跑一次这个脚本，看 alpha=0 的比例是不是还在涨。');
lines.push('');

fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
console.log(`total=${agg.total} scored=${agg.scored} unscored=${agg.unscored} alpha0=${agg.alphaZero} betaNeg=${agg.betaNeg} noKeywords=${agg.noKeywords}`);
console.log('written', outFile);
console.log('worst 3:');
for (const w of worst.slice(0, 3)) console.log(' -', w.id, w.chars, w.title);
