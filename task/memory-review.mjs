#!/usr/bin/env node
// 补分助手：把「未打分（alpha=0，永远调不出来）」的条目按内容大小列出来，
// 带一段原文摘录，交给我在下一轮用 memory_judge 真读过再打分。
// 只读；打分走 memory_judge，不直接改归档文件。
// 用法：node memory-review.mjs [--n 5] [--min-chars 800] [--excerpt 300]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const home = process.env.USERPROFILE || '.';
const root = path.join(home, '.dsh/profiles/desktop/node_modules/dsh-rofm/memory/sessions');
const want = Number(arg('n', 5));
const minChars = Number(arg('min-chars', 300));
const excerptLen = Number(arg('excerpt', 300));

const picked = [];
for (const s of fs.existsSync(root) ? fs.readdirSync(root) : []) {
  const dir = path.join(root, s);
  if (!fs.statSync(dir).isDirectory()) continue;
  const idxPath = path.join(dir, 'index.json');
  if (!fs.existsSync(idxPath)) continue;
  let idx;
  try { idx = JSON.parse(fs.readFileSync(idxPath, 'utf8')); } catch { continue; }
  for (const f of idx.folders || []) {
    if (f.scored) continue;
    if ((f.chars || 0) < minChars) continue;
    picked.push({ session: s, dir, id: f.id, chars: f.chars, title: f.title });
  }
}
picked.sort((a, b) => b.chars - a.chars);

const out = [];
let skippedJson = 0;
for (const p of picked) {
  if (out.length >= want) break;
  let excerpt = '';
  const ctxPath = path.join(p.dir, p.id, 'context.json');
  try {
    const ctx = JSON.parse(fs.readFileSync(ctxPath, 'utf8'));
    const msgs = ctx.messages || [];
    const first = msgs.find((m) => m.role === 'user') || msgs[0] || {};
    excerpt = String(first.content || '').replace(/\s+/g, ' ').trim();
  } catch {
    excerpt = '(读不到 context.json)';
  }
  // 以 { 或 [ 开头的基本是工具输出（插件列表、源码、日志）——那种保持 alpha=0 才对，
  // 为了数字好看去给它们打分，本身就是「记忆污染」。
  if (excerpt.startsWith('{') || excerpt.startsWith('[') || excerpt.startsWith('tool:')) { skippedJson++; continue; }
  out.push({ id: p.id, chars: p.chars, title: String(p.title || '').slice(0, 50), excerpt: excerpt.slice(0, excerptLen) });
}

console.log(`# 待补分 ${picked.length} 条（未打分且 >= ${minChars} 字），跳过工具输出 ${skippedJson} 条，取 ${out.length} 条`);
for (const o of out) {
  console.log(`\n## ${o.id} · ${o.chars} 字`);
  console.log(`标题：${o.title}`);
  console.log(`摘录：${o.excerpt}`);
}
