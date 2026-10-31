// 调度逻辑的单元检查：什么时候该跑，什么时候不该跑。
import { isDue, normalize } from '../index.js'

const cfg = normalize({ hour: 4, minute: 0, retryMs: 30 * 60 * 1000 })
const at = (iso) => new Date(iso)

const cases = [
  {
    name: '从未备份过，凌晨 02:00 启动 → 补跑',
    state: {},
    now: at('2026-10-31T02:00:00+08:00'),
    expect: true,
  },
  {
    name: '今天已经备份过 → 不再跑',
    state: { lastSuccessDay: '2026-10-30' },
    now: at('2026-10-30T23:59:00+08:00'),
    expect: false,
  },
  {
    name: '昨天备份过、现在 03:00（还没到 04:00）→ 不跑',
    state: { lastSuccessDay: '2026-10-30' },
    now: at('2026-10-31T03:00:00+08:00'),
    expect: false,
  },
  {
    name: '昨天备份过、现在 04:01 → 跑',
    state: { lastSuccessDay: '2026-10-30' },
    now: at('2026-10-31T04:01:00+08:00'),
    expect: true,
  },
  {
    name: '两天没跑过、现在 02:00 → 立刻补',
    state: { lastSuccessDay: '2026-10-29' },
    now: at('2026-10-31T02:00:00+08:00'),
    expect: true,
  },
  {
    name: '十分钟前刚失败过 → 退避，不再重试',
    state: { lastSuccessDay: '2026-10-29', lastAttemptAt: '2026-10-31T03:50:00.000Z' },
    now: at('2026-10-31T11:55:00+08:00'),
    expect: false,
  },
]

let failed = 0
for (const testCase of cases) {
  const got = isDue(cfg, testCase.state, testCase.now)
  const pass = got === testCase.expect
  if (!pass) failed += 1
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${testCase.name}  (got ${got}, want ${testCase.expect})`)
}
console.log(failed === 0 ? 'VERDICT: schedule logic ok' : `VERDICT: ${failed} case(s) failed`)
process.exit(failed === 0 ? 0 : 1)
