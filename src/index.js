// dsh-health-assistant/src/index.js
// Host 半：健康提醒完全在客户端跑（计时、存储、提示都在浏览器里），
// 宿主只提供一个空 Service，让包成为合法的 Cordis 插件。
// 这样做的原因：提醒不该依赖后台进程，关掉页面就该停止计时。

import { Service } from '@deepseek-ai/cordis'

export default class HealthAssistant extends Service {
  constructor(ctx) {
    super(ctx, 'healthAssistant')
  }
}