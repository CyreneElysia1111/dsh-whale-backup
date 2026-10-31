// 命令行入口：给 Windows 计划任务用。不依赖 DSH 运行、不依赖 cordis。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { runBackup, normalize } from '../index.js'

const cfg = normalize({})
const stamp = new Date().toISOString()

const dayKey = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function readState() {
  try {
    return JSON.parse(await readFile(cfg.statePath, 'utf8'))
  } catch {
    return {}
  }
}

async function writeState(next) {
  await mkdir(path.dirname(cfg.statePath), { recursive: true })
  await writeFile(cfg.statePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

const prev = await readState()

try {
  const result = await runBackup(cfg)
  const state = result.changed ? `committed ${result.commit}` : 'no change'
  console.log(`[${stamp}] ok  ${state}  files=${result.files}  dir=${result.dir}`)
  if (result.missing.length > 0) console.log(`[${stamp}] missing: ${result.missing.join(', ')}`)
  // 2026-10-31 补：命令行这条路以前不写账本，导致 whale-backup-state.json 一直停在
  // 插件内调度那次（13:59），跟仓库最新提交对不上。这里补上同样的字段。
  await writeState({
    ...prev,
    lastAttemptAt: stamp,
    lastRunAt: result.ranAt || stamp,
    lastSuccessDay: dayKey(new Date()),
    lastResult: 'ok',
    lastCommit: result.commit,
    lastFiles: result.files,
    lastChanged: result.changed,
    lastError: '',
  })
  process.exit(0)
} catch (error) {
  const message = (error && error.message) || String(error)
  console.error(`[${stamp}] failed: ${message}`)
  try {
    await writeState({ ...prev, lastAttemptAt: stamp, lastResult: 'error', lastError: message })
  } catch {}
  process.exit(1)
}
