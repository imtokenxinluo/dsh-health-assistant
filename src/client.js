// dsh-health-assistant/src/client.js
// Client 半：休息提醒（overlay 浮层）+ 专注计时（composer 下方）+ 设置页。
// 全部本地运行：不联网、不上报，状态只存在 localStorage。

import { createElement as h, useState, useEffect, useRef } from 'react'
import {
  DEFAULT_SETTINGS, TICK_MS, freshState, tick, formatDuration,
  snooze, muteToday, takeRest, isMutedToday,
} from './timing.js'

const K_SETTINGS = 'dsh-health:settings'
const K_STATE = 'dsh-health:state'
const STYLE_ID = 'dsh-health-assistant-styles'

// ── 本地存储 ────────────────────────────────────────────────────────────────

function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 隐私模式 / 配额满：静默降级 */
  }
}

// ── 状态 ────────────────────────────────────────────────────────────────────

let settings = { ...DEFAULT_SETTINGS, ...(readJson(K_SETTINGS, {}) || {}) }
let state = readJson(K_STATE, null) || freshState(Date.now())
let prompt = null
let lastInteract = Date.now()
const listeners = new Set()

function persist() {
  writeJson(K_STATE, state)
  writeJson(K_SETTINGS, settings)
}

function emit() {
  listeners.forEach((fn) => {
    try { fn() } catch { /* 单个组件出错不影响其他 */ }
  })
}

function clearPrompt() {
  prompt = null
  persist()
  emit()
}

function runTick() {
  const now = Date.now()
  const visible = typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
  const idleMin = (now - lastInteract) / 60000
  const before = state
  const result = tick(state, settings, now, { visible, idleMin })
  state = result.state
  if (result.prompt) {
    prompt = result.prompt
    if (settings.notifySystem) fireSystemNotification(result.prompt.title, result.prompt.body)
  }
  if (result.state !== before || result.prompt) {
    persist()
    emit()
  }
}

let engineStarted = false
function startEngine() {
  if (engineStarted || typeof window === 'undefined') return
  engineStarted = true
  const touch = () => { lastInteract = Date.now() }
  window.addEventListener('pointerdown', touch, { passive: true })
  window.addEventListener('keydown', touch)
  window.addEventListener('wheel', touch, { passive: true })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') lastInteract = Date.now()
  })
  setInterval(runTick, TICK_MS)
  runTick()
}

/** 订阅 store（组件挂载时调用） */
function useHealthStore() {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((n) => n + 1)
    listeners.add(fn)
    startEngine()
    return () => { listeners.delete(fn) }
  }, [])
  return { settings, state, prompt }
}

function updateSettings(patch) {
  settings = { ...settings, ...patch }
  persist()
  emit()
}

// ── 样式 ────────────────────────────────────────────────────────────────────

const CSS = [
  '.dha-toast{position:fixed;right:20px;bottom:20px;z-index:9998;max-width:360px;display:flex;gap:12px;',
  'padding:14px 16px;border-radius:14px;background:#1f2430;color:#e8eaed;',
  'box-shadow:0 12px 32px rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.1);font-size:13px;line-height:1.55}',
  '.dha-icon{font-size:20px;line-height:1.2}',
  '.dha-body{flex:1;min-width:0}',
  '.dha-title{font-weight:700;font-size:14px;margin-bottom:2px;display:flex;align-items:baseline;justify-content:space-between;gap:10px}',
  '.dha-count{font-weight:400;font-size:11px;color:#8a8f98;font-variant-numeric:tabular-nums}',
  '.dha-text{color:#a9b1bd}',
  '.dha-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}',
  '.dha-actions button{font:inherit;font-size:12px;padding:4px 10px;border-radius:8px;cursor:pointer;',
  'border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#e8eaed}',
  '.dha-actions button:hover{background:rgba(255,255,255,.16)}',
  '.dha-actions button.primary{background:#2b6cb0;border-color:#2b6cb0;color:#fff}',
  '.dha-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a8f98);',
  'padding:2px 2px;user-select:none}',
  '.dha-chip b{font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#5b6470)}',
  '.dha-chip.muted{opacity:.55}',
  '.dha-panel{display:flex;flex-direction:column;gap:14px;font-size:14px;color:var(--dsw-alias-label-primary,#1f2328)}',
  '.dha-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0;',
  'border-bottom:1px solid var(--dsw-alias-border-l1,#eceef1)}',
  '.dha-row:last-child{border-bottom:none}',
  '.dha-label{display:flex;flex-direction:column;gap:2px}',
  '.dha-label small{color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:12px}',
  '.dha-input{width:72px;padding:4px 8px;border-radius:8px;font:inherit;text-align:right;',
  'border:1px solid var(--dsw-alias-border-l1,#e5e5e5);background:var(--dsw-alias-bg-primary,#fff);color:inherit}',
  '.dha-foot{display:flex;gap:10px;align-items:center;color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:12px}',
  '.dha-link{background:none;border:none;padding:0;font:inherit;color:#2b6cb0;cursor:pointer;text-decoration:underline}',
].join('')

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

/** 系统通知（可选）：需要浏览器授权，授权动作必须由用户点击触发 */
function fireSystemNotification(title, body) {
  try {
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted') return
    const n = new Notification(title, { body, tag: 'dsh-health-assistant' })
    n.onclick = () => {
      try { window.focus() } catch { /* 忽略 */ }
      n.close()
    }
  } catch {
    /* 通知失败不影响页面内提醒 */
  }
}
// ── 浮层提醒 ────────────────────────────────────────────────────────────────

const TOAST_AUTO_HIDE_SEC = 20

function HealthToast() {
  const { prompt: p } = useHealthStore()
  useEffect(() => { ensureStyles() }, [])

  const [left, setLeft] = useState(TOAST_AUTO_HIDE_SEC)
  const hoverRef = useRef(false)

  // 每次出现新提醒：重置倒计时，20 秒后自动收起（鼠标悬停时暂停）
  useEffect(() => {
    if (!p) return undefined
    setLeft(TOAST_AUTO_HIDE_SEC)
    let remain = TOAST_AUTO_HIDE_SEC
    const timer = setInterval(() => {
      if (hoverRef.current) return
      remain -= 1
      setLeft(remain)
      if (remain <= 0) {
        clearInterval(timer)
        clearPrompt()
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [p])

  if (!p) return null

  const icon = p.kind === 'night' ? '🌙' : p.kind === 'long' ? '🪫' : '🧘'

  return h('div', {
    className: 'dha-toast',
    role: 'status',
    'aria-live': 'polite',
    onMouseEnter: () => { hoverRef.current = true },
    onMouseLeave: () => { hoverRef.current = false },
  },
  h('div', { className: 'dha-icon' }, icon),
  h('div', { className: 'dha-body' },
    h('div', { className: 'dha-title' },
      p.title,
      h('span', { className: 'dha-count' }, left > 0 ? left + 's' : '')),
    h('div', { className: 'dha-text' }, p.body),
    h('div', { className: 'dha-actions' },
      h('button', {
        type: 'button',
        className: 'primary',
        onClick: () => { state = takeRest(state, Date.now()); clearPrompt() },
      }, '休息一下'),
      h('button', {
        type: 'button',
        onClick: () => { state = snooze(state, 10, Date.now()); clearPrompt() },
      }, '10 分钟后再提醒'),
      h('button', {
        type: 'button',
        onClick: () => { state = muteToday(state, Date.now()); clearPrompt() },
      }, '今天不再提醒'))))
}
// ── 专注计时（composer 下方一行）────────────────────────────────────────────

function HealthChip() {
  const { settings: s, state: st } = useHealthStore()
  if (!s.enabled) return null
  const muted = isMutedToday(st, Date.now())
  return h('div', {
    className: 'dha-chip' + (muted ? ' muted' : ''),
    title: muted ? '今天已静默，明天恢复提醒' : '本次专注时长（离开 5 分钟以上会清零）',
  },
  h('span', null, '🧘'),
  h('b', null, formatDuration(st.activeMin)),
  muted ? h('span', null, '· 今日静默') : null)
}

// ── 设置页 ──────────────────────────────────────────────────────────────────

function NumberRow({ label, hint, value, min, max, unit, onChange }) {
  return h('div', { className: 'dha-row' },
    h('div', { className: 'dha-label' }, h('span', null, label), hint ? h('small', null, hint) : null),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
      h('input', {
        className: 'dha-input',
        type: 'number',
        min,
        max,
        value,
        onChange: (e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n) && n >= min && n <= max) onChange(Math.round(n))
        },
      }),
      h('span', { style: { color: 'var(--dsw-alias-label-tertiary,#8a8f98)', fontSize: 12 } }, unit)))
}

function ToggleRow({ label, hint, checked, onChange }) {
  return h('div', { className: 'dha-row' },
    h('div', { className: 'dha-label' }, h('span', null, label), hint ? h('small', null, hint) : null),
    h('input', { type: 'checkbox', checked, onChange: (e) => onChange(e.target.checked) }))
}
function HealthSettings() {
  const { settings: s, state: st } = useHealthStore()
  useEffect(() => { ensureStyles() }, [])
  const muted = isMutedToday(st, Date.now())

  return h('div', { className: 'dha-panel' },
    h('div', { className: 'dha-row' },
      h('div', { className: 'dha-label' },
        h('span', null, '启用提醒'),
        h('small', null, '完全本地运行，不联网、不上报')),
      h('input', {
        type: 'checkbox',
        checked: s.enabled,
        onChange: (e) => updateSettings({ enabled: e.target.checked }),
      })),
    h(ToggleRow, {
      label: '后台也计时',
      hint: '切到别的应用时继续计时（默认关闭：看不见就当你休息）',
      checked: !!s.background,
      onChange: (v) => updateSettings({ background: v }),
    }),

    h(ToggleRow, {
      label: '系统通知',
      hint: (typeof Notification === 'undefined'
        ? '当前浏览器不支持'
        : Notification.permission === 'granted' ? '已授权，切到后台也会弹窗' : '开启时会请求浏览器授权'),
      checked: !!s.notifySystem && (typeof Notification !== 'undefined' && Notification.permission === 'granted'),
      onChange: (v) => {
        if (!v) { updateSettings({ notifySystem: false }); return }
        if (typeof Notification === 'undefined') { updateSettings({ notifySystem: false }); return }
        // 授权必须由点击触发，所以放在这里
        Notification.requestPermission().then((p) => updateSettings({ notifySystem: p === 'granted' }))
      },
    }),

    h(NumberRow, {
      label: '专注多久提醒休息',
      hint: '默认 30 分钟；离开 5 分钟以上会清零',
      value: s.restEveryMin,
      min: 5,
      max: 180,
      unit: '分钟',
      onChange: (v) => updateSettings({ restEveryMin: v }),
    }),

    h(NumberRow, {
      label: '连续工作提醒（第一档）',
      hint: '到点提醒一次，不重复',
      value: s.longHours[0],
      min: 1,
      max: 12,
      unit: '小时',
      onChange: (v) => updateSettings({ longHours: [v, s.longHours[1]] }),
    }),

    h(NumberRow, {
      label: '连续工作提醒（第二档）',
      hint: '建议比第一档更明确地劝停',
      value: s.longHours[1],
      min: 2,
      max: 16,
      unit: '小时',
      onChange: (v) => updateSettings({ longHours: [s.longHours[0], v] }),
    }),

    h(NumberRow, {
      label: '熬夜时段开始',
      hint: '跨零点生效（如 23 → 6）',
      value: s.nightStart,
      min: 0,
      max: 23,
      unit: '点',
      onChange: (v) => updateSettings({ nightStart: v }),
    }),

    h(NumberRow, {
      label: '熬夜时段结束',
      value: s.nightEnd,
      min: 0,
      max: 23,
      unit: '点',
      onChange: (v) => updateSettings({ nightEnd: v }),
    }),

    h(NumberRow, {
      label: '熬夜提醒间隔',
      value: s.nightEveryMin,
      min: 10,
      max: 120,
      unit: '分钟',
      onChange: (v) => updateSettings({ nightEveryMin: v }),
    }),

    h('div', { className: 'dha-foot' },
      h('span', null, '当前专注 ' + formatDuration(st.activeMin)),
      muted
        ? h('button', {
          type: 'button',
          className: 'dha-link',
          onClick: () => updateSettings({}), // 不改变设置，仅触发重渲染
        }, '今天已静默')
        : h('button', {
          type: 'button',
          className: 'dha-link',
          onClick: () => { state = muteToday(state, Date.now()); persist(); emit() },
        }, '今天不再提醒'),
      h('button', {
        type: 'button',
        className: 'dha-link',
        onClick: () => {
          settings = { ...DEFAULT_SETTINGS }
          state = freshState(Date.now())
          persist()
          emit()
        },
      }, '恢复默认')))
}

// ── 插件入口 ────────────────────────────────────────────────────────────────

export default {
  inject: ['slots'],
  apply(ctx) {
    const slots = ctx.slots
    if (!slots) return

    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'health-toast', order: 50 },
      () => h(HealthToast),
    ))

    slots.inject('conversation.composer.dock', () => slots.register(
      { name: 'conversation.composer.dock', id: 'health-chip', order: 30 },
      () => h(HealthChip),
    ))

    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'health-assistant', label: '健康助手', order: 74 },
      () => h(HealthSettings),
    ))
  },
}
