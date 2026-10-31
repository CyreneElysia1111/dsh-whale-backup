// 校验：备份里的东西，和现在盘上的东西，是不是同一份。
//   node task/verify.mjs                 比"仓库里的快照" vs "现在的文件"
//   node task/verify.mjs --clone <dir>   比"克隆出来的快照" vs "现在的文件"
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { normalize } from '../index.js'

const cfg = normalize({})
const cloneIndex = process.argv.indexOf('--clone')
const base = cloneIndex > -1 ? process.argv[cloneIndex + 1] : cfg.repoDir

const roots = { dsh: cfg.dshHome, 'bili-ai': cfg.biliHome }

const manifest = JSON.parse(await readFile(path.join(base, 'snapshot', 'manifest.json'), 'utf8'))
const hash = (buf) => createHash('sha256').update(buf).digest('hex')

let same = 0
let diff = 0
let missingLive = 0
const problems = []

for (const entry of manifest.files) {
  const rel = entry.path.replace(/^snapshot\//, '')
  const slash = rel.indexOf('/')
  const label = rel.slice(0, slash)
  const name = rel.slice(slash + 1)
  const livePath = path.join(roots[label] ?? '', name)
  const backupPath = path.join(base, entry.path)

  let liveBuf
  try {
    liveBuf = await readFile(livePath)
  } catch {
    missingLive += 1
    problems.push(`LIVE-GONE ${entry.path}`)
    continue
  }

  let backupBuf
  try {
    backupBuf = await readFile(backupPath)
  } catch {
    diff += 1
    problems.push(`BACKUP-GONE ${entry.path}`)
    continue
  }

  if (hash(liveBuf) === hash(backupBuf)) {
    same += 1
  } else {
    diff += 1
    problems.push(`DIFF ${entry.path}`)
  }
}

const total = manifest.files.length
console.log(`source: ${base}`)
console.log(`files in manifest: ${total}`)
console.log(`identical: ${same}   differ: ${diff}   live-file-gone: ${missingLive}`)
for (const line of problems) console.log(`  ${line}`)

const ok = diff === 0 && missingLive === 0
console.log(ok ? 'VERDICT: backup matches the live files' : 'VERDICT: something is off (see above)')
process.exit(ok ? 0 : 1)
