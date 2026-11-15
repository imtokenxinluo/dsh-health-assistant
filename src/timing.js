// dsh-health-assistant/src/timing.js
// 健康提醒的纯逻辑：不碰 DOM、不碰 storage，方便测试。
//
// 设计取舍：
//   · 只有在页面可见、且最近 5 分钟有交互时才算「在工作」；
//   · 连续工作多久（workStart）和累计专注多久（activeMin）分开算 ——
//     休息过的会话 workStart 不变，但 activeMin 会清零；
//   · 同一档长时提醒只触发一次（longSent），避免每 15 秒弹一遍。

export const DEFAULT_SETTINGS = {
  enabled: true,
  restEveryMin: 30, // 每专注多少分钟提醒休息
  restMin: 5, // 建议休息多久（只用于文案）
  longHours: [2, 4], // 连续工作到第几小时提醒一次
  nightStart: 23, // 熬夜时段起点（含）
  nightEnd: 6, // 熬夜时段终点（不含）
  nightEveryMin: 30, // 熬夜期间最短提醒间隔
  background: false, // 页面在后台时是否继续计时
  notifySystem: false, // 是否用系统通知（需要浏览器授权）
}

export const IDLE_RESET_MIN = 5
export const TICK_MS = 15000

const MIN = 60000
const HOUR = 3600000

function pad(n) {
  return String(n).padStart(2, '0')
}

/** 本地日期键 YYYY-MM-DD（用于「今天不再提醒」） */
export function dayKey(ms) {
  const d = new Date(ms)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

export function freshState(nowMs) {
  return {
    activeMin: 0, // 本次专注累计分钟（休息后清零）
    workStart: nowMs, // 连续工作的起点（休息不清零）
    lastTick: nowMs,
    lastRest: null,
    longSent: [], // 已触发过的长时档位
    nightSentAt: null,
    snoozeUntil: null,
    mutedDay: null,
  }
}

/** 当前小时是否落在熬夜时段（支持跨零点，如 23 → 6） */
export function inNightWindow(hour, settings) {
  const start = Number(settings.nightStart)
  const end = Number(settings.nightEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false
  if (start > end) return hour >= start || hour < end
  return hour >= start && hour < end
}

export function formatDuration(min) {
  const total = Math.max(0, Math.round(min))
  if (total < 60) return total + ' 分钟'
  const h = Math.floor(total / 60)
  const m = total % 60
  return m === 0 ? h + ' 小时' : h + ' 小时 ' + m + ' 分'
}

function promptFor(kind, ctx) {
  if (kind === 'rest') {
    return {
      kind: 'rest',
      title: '该歇 ' + ctx.restMin + ' 分钟了',
      body: '已经专注 ' + ctx.restEveryMin + ' 分钟。站起来走两步，看看六米外的东西。',
    }
  }
  if (kind === 'night') {
    return {
      kind: 'night',
      title: '已经是深夜了',
      body: '熬夜换来的这一小时，不如明早清醒时的一刻钟。收个尾，去睡吧。',
    }
  }
  if (kind === 'long') {
    if (ctx.hours >= 4) {
      return {
        kind: 'long',
        title: '连续工作 ' + ctx.hours + ' 小时了',
        body: '今天已经够久了。建议收尾、记下明天第一件事，然后离开屏幕。',
      }
    }
    return {
      kind: 'long',
      title: '连续工作 ' + ctx.hours + ' 小时了',
      body: '起来活动 10 分钟，喝口水。回来之后效率会更高。',
    }
  }
  return null
}

/**
 * 推进一次状态。返回 { state, prompt }，prompt 为 null 表示这次不该提醒。
 *
 * env: { visible: boolean, idleMin: number }
 */
export function tick(state, settings, nowMs, env) {
  const s = { ...settings }
  if (!s.enabled) return { state: { ...state, lastTick: nowMs }, prompt: null }

  // 页面不可见时：除非开了「后台也计时」，否则不累计也不提醒（人在别处）
  const background = !!settings.background && !env.visible
  if (!env.visible && !background) return { state: { ...state, lastTick: nowMs }, prompt: null }

  // 离开超过阈值 → 视为已经休息过，清空专注时长。
  // 后台模式下不做这个判断：那时人可能压根不在本页面，idle 必然很大。
  if (!background && env.idleMin >= IDLE_RESET_MIN) {
    const reset = freshState(nowMs)
    reset.snoozeUntil = state.snoozeUntil
    reset.mutedDay = state.mutedDay
    return { state: reset, prompt: null }
  }

  const dt = Math.min(Math.max(0, (nowMs - state.lastTick) / MIN), 5) // 单次最多记 5 分钟，防挂起回填
  const next = {
    ...state,
    lastTick: nowMs,
    activeMin: state.activeMin + dt,
    workStart: state.workStart || nowMs,
  }

  if (next.mutedDay === dayKey(nowMs)) return { state: next, prompt: null }
  if (next.snoozeUntil && nowMs < next.snoozeUntil) return { state: next, prompt: null }

  const hour = new Date(nowMs).getHours()
  const candidates = []

  // 熬夜：按 nightEveryMin 节流
  if (inNightWindow(hour, s)) {
    const due = !next.nightSentAt || nowMs - next.nightSentAt >= s.nightEveryMin * MIN
    if (due) {
      next.nightSentAt = nowMs
      candidates.push(promptFor('night', {}))
    }
  }

  // 长时：每个档位只提醒一次
  const workedHours = (nowMs - next.workStart) / HOUR
  for (const h of s.longHours || []) {
    if (workedHours >= h && !next.longSent.includes(h)) {
      next.longSent = [...next.longSent, h]
      candidates.push(promptFor('long', { hours: h }))
    }
  }

  // 专注计时到点 → 提醒休息，并把专注时长清零
  if (next.activeMin >= s.restEveryMin) {
    next.activeMin = 0
    next.lastRest = nowMs
    candidates.push(promptFor('rest', { restMin: s.restMin, restEveryMin: s.restEveryMin }))
  }

  if (candidates.length === 0) return { state: next, prompt: null }

  // 优先级：熬夜 > 长时(4h) > 长时(2h) > 休息
  const rank = (p) => (p.kind === 'night' ? 3 : p.kind === 'long' ? (p.title.includes('4 小时') ? 2.5 : 2) : 1)
  candidates.sort((a, b) => rank(b) - rank(a))
  return { state: next, prompt: candidates[0] }
}

export function snooze(state, minutes, nowMs) {
  return { ...state, snoozeUntil: nowMs + minutes * MIN }
}

export function muteToday(state, nowMs) {
  return { ...state, mutedDay: dayKey(nowMs) }
}

/** 记一次休息（用户点「休息一下」） */
export function takeRest(state, nowMs) {
  return {
    ...state,
    activeMin: 0,
    lastRest: nowMs,
    snoozeUntil: nowMs + 10 * MIN,
  }
}

export function isMutedToday(state, nowMs) {
  return state.mutedDay === dayKey(nowMs)
}
