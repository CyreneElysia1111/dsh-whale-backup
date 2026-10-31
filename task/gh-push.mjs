// 用 GitHub REST API 推仓库（这台机器上 git 走 https 会挂，node fetch 走系统证书正常）
// 用法: node _gh_push.mjs <localDir> <repoName> <private|public> "<description>" ["<commit message>"]
import fs from 'node:fs'
import path from 'node:path'

const token = fs.readFileSync('C:/Users/31279/.dsh/github-token.txt', 'utf8').trim()
const H = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'dsh-whale',
  'Content-Type': 'application/json',
}

async function api(method, p, body) {
  const r = await fetch('https://api.github.com' + p, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text.slice(0, 300) } }
  return { status: r.status, json }
}

const [dir, repoName, visibility, description, commitMsg] = process.argv.slice(2)
if (!dir || !repoName || !visibility) {
  console.error('usage: node _gh_push.mjs <dir> <repo> <private|public> [desc] [msg]')
  process.exit(2)
}

const me = await api('GET', '/user')
if (me.status !== 200) { console.error('token bad', me.status); process.exit(1) }
const owner = me.json.login

const exists = await api('GET', `/repos/${owner}/${repoName}`)
if (exists.status === 404) {
  const created = await api('POST', '/user/repos', {
    name: repoName,
    description: description || '',
    private: visibility === 'private',
    auto_init: false,
    has_issues: false,
    has_wiki: false,
  })
  console.log('create', repoName, created.status, created.json && created.json.full_name)
  if (created.status >= 300) { console.error(JSON.stringify(created.json).slice(0, 300)); process.exit(1) }
} else {
  console.log('repo exists', repoName, exists.status, exists.json.private ? 'private' : 'public')
}

// 空仓库不能直接建 blob（409 Git Repository is empty）→ 先用 Contents API 塞一个 README 建出 main 分支
// 判断是否为空要看 main 分支在不在：repo.size 以 KB 计，小仓库恒为 0，会每次多一条占位提交
const headProbe = await api('GET', `/repos/${owner}/${repoName}/git/ref/heads/main`)
if (headProbe.status === 404) {
  const seed = await api('PUT', `/repos/${owner}/${repoName}/contents/README.md`, {
    message: 'init',
    content: Buffer.from('# ' + repoName + '\n\n(placeholder, replaced by the first push)\n').toString('base64'),
  })
  console.log('seed README', seed.status)
  if (seed.status === 422) {
    // 仓库里已经有 README（建库时勾了 auto_init）→ 拿 sha 再写一次
    const cur = await api('GET', `/repos/${owner}/${repoName}/contents/README.md`)
    if (cur.status === 200) {
      const upd = await api('PUT', `/repos/${owner}/${repoName}/contents/README.md`, {
        message: 'init',
        sha: cur.json.sha,
        content: Buffer.from('# ' + repoName + '\n\n(placeholder, replaced by the first push)\n').toString('base64'),
      })
      console.log('seed README (update)', upd.status)
      if (upd.status >= 300) { console.error(JSON.stringify(upd.json).slice(0, 300)); process.exit(1) }
    }
  } else if (seed.status >= 300) { console.error(JSON.stringify(seed.json).slice(0, 300)); process.exit(1) }
}

// 收集文件
const files = []
const skip = new Set(['.git', 'node_modules', '.DS_Store'])
function walk(d, rel) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (skip.has(e.name)) continue
    const abs = path.join(d, e.name)
    const r = rel ? rel + '/' + e.name : e.name
    if (e.isDirectory()) walk(abs, r)
    else if (e.isFile()) files.push({ abs, rel: r })
  }
}
walk(dir, '')
console.log('files', files.length)

// 建 blobs（并发 5）
const tree = []
let idx = 0
async function worker() {
  while (idx < files.length) {
    const f = files[idx++]
    const buf = fs.readFileSync(f.abs)
    const r = await api('POST', `/repos/${owner}/${repoName}/git/blobs`, {
      content: buf.toString('base64'),
      encoding: 'base64',
    })
    if (r.status !== 201) { console.error('blob fail', f.rel, r.status, JSON.stringify(r.json).slice(0, 200)); continue }
    tree.push({ path: f.rel, mode: '100644', type: 'blob', sha: r.json.sha })
  }
}
await Promise.all([worker(), worker(), worker(), worker(), worker()])
console.log('blobs', tree.length)

const treeRes = await api('POST', `/repos/${owner}/${repoName}/git/trees`, { tree })
if (treeRes.status !== 201) { console.error('tree fail', JSON.stringify(treeRes.json).slice(0, 300)); process.exit(1) }

const refRes = await api('GET', `/repos/${owner}/${repoName}/git/ref/heads/main`)
const parents = refRes.status === 200 && refRes.json && refRes.json.object ? [refRes.json.object.sha] : []

// 内容没变就不提交（否则每天/每周都多一条空提交）
if (parents.length > 0) {
  const cur = await api('GET', `/repos/${owner}/${repoName}/git/commits/${parents[0]}`)
  if (cur.status === 200 && cur.json && cur.json.tree && cur.json.tree.sha === treeRes.json.sha) {
    console.log('no change, skip commit')
    process.exit(0)
  }
}

const commitRes = await api('POST', `/repos/${owner}/${repoName}/git/commits`, {
  message: commitMsg || 'initial commit',
  tree: treeRes.json.sha,
  parents,
})
if (commitRes.status !== 201) { console.error('commit fail', JSON.stringify(commitRes.json).slice(0, 300)); process.exit(1) }

if (parents.length === 0) {
  const refNew = await api('POST', `/repos/${owner}/${repoName}/git/refs`, {
    ref: 'refs/heads/main',
    sha: commitRes.json.sha,
  })
  console.log('ref create', refNew.status)
} else {
  const refUp = await api('PATCH', `/repos/${owner}/${repoName}/git/refs/heads/main`, {
    sha: commitRes.json.sha,
    force: true,
  })
  console.log('ref update', refUp.status)
}

const final = await api('GET', `/repos/${owner}/${repoName}`)
console.log('OK', final.json.html_url, final.json.size + 'KB', final.json.private ? 'private' : 'public')
