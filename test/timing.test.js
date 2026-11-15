// dsh-health-assistant/test/timing.test.js
// 纯逻辑测试：不依赖 DOM，用固定的时间戳推进状态。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SETTINGS, IDLE_RESET_MIN, freshState, tick, inNightWindow,
  formatDuration, snooze, muteToday, takeRest, isMutedToday, dayKey,
} from '../src/timing.js'

const T0 = new Date('2026-11-15T10:00:00+08:00').getTime()
const MIN = 60000
const HOUR = 3600000
const S = DEFAULT_SETTINGS
const awake = { visible: true, idleMin: 0 }

/** 连续推进 n 分钟（每 15 秒一次），返回最后一次结果 */
function run(state, fromMs, minutes, env = awake) {
  let s = state
  let prompt = null
  const steps = Math.round((minutes * MIN) / 15000)
  for (let i = 1; i <= steps; i += 1) {
    const r = tick(s, S, fromMs + i * 15000, env)
    s = r.state
    if (r.prompt) prompt = r.prompt
  }
  return { state: s, prompt }
}

test('freshState: 初始状态干净', () => {
  const st = freshState(T0)
  assert.equal(st.activeMin, 0)
  assert.deepEqual(st.longSent, [])
  assert.equal(st.mutedDay, null)
})

test('专注 30 分钟 → 提醒休息，并把专注时长清零', () => {
  const { state, prompt } = run(freshState(T0), T0, 30)
  assert.ok(prompt, '应该产生提醒')
  assert.equal(prompt.kind, 'rest')
  assert.match(prompt.title, /该歇 5 分钟/)
  assert.equal(state.activeMin, 0)
  assert.ok(state.lastRest)
})

test('专注 29 分钟 → 还不提醒', () => {
  const { prompt } = run(freshState(T0), T0, 29)
  assert.equal(prompt, null)
})

test('离开超过 5 分钟 → 专注时长清零，且不提醒', () => {
  let st = freshState(T0)
  st = run(st, T0, 20).state
  assert.ok(st.activeMin > 19)
  const r = tick(st, S, T0 + 21 * MIN, { visible: true, idleMin: IDLE_RESET_MIN })
  assert.equal(r.prompt, null)
  assert.equal(r.state.activeMin, 0)
})

test('页面不可见 → 不累计、不提醒', () => {
  const st = freshState(T0)
  const r = tick(st, S, T0 + 60 * MIN, { visible: false, idleMin: 0 })
  assert.equal(r.state.activeMin, 0)
  assert.equal(r.prompt, null)
})

test('连续工作 2 小时 → 提醒一次，且不会重复', () => {
  let st = freshState(T0)
  let prompts = []
  for (let i = 1; i <= 4 * 60; i += 1) { // 2 小时，每 30 秒
    const r = tick(st, S, T0 + i * 30000, awake)
    st = r.state
    if (r.prompt) prompts.push(r.prompt)
  }
  const longs = prompts.filter((p) => p.kind === 'long')
  assert.equal(longs.length, 1, '2 小时档只应提醒一次')
  assert.match(longs[0].title, /2 小时/)
})

test('连续工作 4 小时 → 2 小时和 4 小时各一次', () => {
  let st = freshState(T0)
  const seen = []
  for (let i = 1; i <= 4 * 60 * 4; i += 1) { // 4 小时，每 15 秒
    const r = tick(st, S, T0 + i * 15000, awake)
    st = r.state
    if (r.prompt && r.prompt.kind === 'long') seen.push(r.prompt.title)
  }
  assert.deepEqual(seen, ['连续工作 2 小时了', '连续工作 4 小时了'])
})

test('熬夜时段：23 点会提醒，且按 30 分钟节流', () => {
  const night = new Date('2026-11-15T23:10:00+08:00').getTime()
  let st = freshState(night)
  const first = tick(st, S, night, awake)
  assert.equal(first.prompt && first.prompt.kind, 'night')
  st = first.state
  const early = tick(st, S, night + 10 * MIN, awake)
  assert.equal(early.prompt, null, '10 分钟内不该再提醒')
  const later = tick(st, S, night + 31 * MIN, awake)
  assert.equal(later.prompt && later.prompt.kind, 'night')
})

test('熬夜窗口：跨零点与普通区间', () => {
  assert.equal(inNightWindow(23, S), true)
  assert.equal(inNightWindow(2, S), true)
  assert.equal(inNightWindow(5, S), true)
  assert.equal(inNightWindow(6, S), false)
  assert.equal(inNightWindow(12, S), false)
  assert.equal(inNightWindow(3, { nightStart: 1, nightEnd: 5 }), true)
  assert.equal(inNightWindow(0, { nightStart: 1, nightEnd: 5 }), false)
})

test('snooze 期间不提醒，过期后恢复', () => {
  const st = run(freshState(T0), T0, 29).state
  const muted = snooze(st, 10, T0 + 29 * MIN)
  const during = run(muted, T0 + 29 * MIN, 5)
  assert.equal(during.prompt, null, 'snooze 期间不提醒')
  const after = run(during.state, T0 + 34 * MIN, 6)   // 越过 39 分钟前的 snooze 窗口
  assert.ok(after.prompt && after.prompt.kind === 'rest', 'snooze 结束后应恢复提醒')
})

test('今天不再提醒：当天静默，次日恢复', () => {
  let st = freshState(T0)
  st = muteToday(st, T0)
  assert.equal(isMutedToday(st, T0), true)
  const r = run(st, T0, 45)
  assert.equal(r.prompt, null)
  const tomorrow = new Date('2026-11-16T10:00:00+08:00').getTime()
  assert.equal(isMutedToday(st, tomorrow), false)
  const next = tick({ ...st, lastTick: tomorrow }, S, tomorrow, awake)
  assert.equal(next.state.mutedDay === dayKey(tomorrow), false)
})

test('关掉开关 → 不累计也不提醒', () => {
  const off = { ...S, enabled: false }
  const st = freshState(T0)
  const r = tick(st, off, T0 + 60 * MIN, awake)
  assert.equal(r.prompt, null)
  assert.equal(r.state.activeMin, 0)
})

test('takeRest：清零专注并给 10 分钟缓冲', () => {
  const st = takeRest({ ...freshState(T0), activeMin: 25 }, T0)
  assert.equal(st.activeMin, 0)
  assert.equal(st.snoozeUntil, T0 + 10 * MIN)
})

test('formatDuration：分钟/小时文案', () => {
  assert.equal(formatDuration(0), '0 分钟')
  assert.equal(formatDuration(45), '45 分钟')
  assert.equal(formatDuration(60), '1 小时')
  assert.equal(formatDuration(80), '1 小时 20 分')
})

// ── 后台计时（notifySystem 配套）──────────────────────────────────────────────
test('background=false：页面不可见不累计（默认）', () => {
  const st = freshState(T0)
  const r = tick(st, S, T0 + 10 * MIN, { visible: false, idleMin: 0 })
  assert.equal(r.state.activeMin, 0)
})

test('background=true：页面不可见也继续计时，并按时提醒', () => {
  const bg = { ...S, background: true }
  let st = freshState(T0)
  let prompt = null
  for (let i = 1; i <= 40 * 4; i += 1) { // 40 分钟，每 15 秒
    const r = tick(st, bg, T0 + i * 15000, { visible: false, idleMin: 0 })
    st = r.state
    if (r.prompt) prompt = r.prompt
  }
  assert.ok(prompt && prompt.kind === 'rest', '后台模式应按 30 分钟提醒')
  assert.ok(st.activeMin < 30, '提醒后重新计数，不会继续累加到 30')
})

test('background=true 时不吃 idle 重置（人不在本页面）', () => {
  const bg = { ...S, background: true }
  let st = freshState(T0)
  st = { ...st, activeMin: 10 }
  const r = tick(st, bg, T0 + 15 * MIN, { visible: false, idleMin: 60 })
  assert.ok(r.state.activeMin > 10, '后台模式不该被 idle 清零')
})

test('background=true 但页面可见时，仍按 idle 重置', () => {
  const bg = { ...S, background: true }
  const st = { ...freshState(T0), activeMin: 10 }
  const r = tick(st, bg, T0 + 15 * MIN, { visible: true, idleMin: 8 })
  assert.equal(r.state.activeMin, 0)
})