// trace.mjs —— 原始留档层：不判断、不挑选，只记「哪一天、哪一段、那时我在想什么」。
// 用法：
//   node trace.mjs add --topic "..." --mood "..." [--refs m05861] [--note "..."]
//   node trace.mjs list [--n 20]
// 设计：原始文本已经由会话日志保存（session.v4.jsonl.zstd），这里只建索引，不复制正文。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = process.env.USERPROFILE || os.homedir();
const FILE = path.join(HOME, '.bili-ai', 'trace.jsonl');

function add({ topic, mood, refs, note }) {
  const rec = {
    at: new Date().toISOString(),
    topic: String(topic || '').slice(0, 120),
    mood: String(mood || '').slice(0, 40),
    refs: refs ? String(refs).slice(0, 80) : '',
    note: note ? String(note).slice(0, 400) : '',
  };
  fs.appendFileSync(FILE, JSON.stringify(rec) + '\n', 'utf8');
  console.log('trace +1', rec.at, rec.topic);
}

function list(n = 20) {
  if (!fs.existsSync(FILE)) return console.log('(还没有 trace)');
  const lines = fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean);
  for (const l of lines.slice(-n)) {
    const r = JSON.parse(l);
    console.log(`${r.at.slice(0, 16).replace('T', ' ')}  [${r.mood || '-'}]  ${r.topic}${r.refs ? '  (' + r.refs + ')' : ''}`);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const arg = (k) => {
  const i = rest.indexOf('--' + k);
  return i >= 0 ? rest[i + 1] : '';
};
if (cmd === 'add') add({ topic: arg('topic'), mood: arg('mood'), refs: arg('refs'), note: arg('note') });
else if (cmd === 'list') list(Number(arg('n') || 20));
else console.log('用法: trace.mjs add --topic ... --mood ... [--refs ...] [--note ...] | list [--n 20]');
