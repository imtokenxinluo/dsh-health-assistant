#!/usr/bin/env node
// 逐个运行 test/*.test.js。
//
// 不用 `node --test test/`：这个 Node 版本会把目录当模块路径去 require，
// 直接报 "Cannot find module ...\test"；而且 cmd.exe 不展开 glob。
// 规则：任一文件退出码非 0 即整体失败。stdio 用 inherit（受限沙箱下 pipe 会被拒）。
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test')
const files = readdirSync(testDir).filter((f) => /\.test\.m?js$/.test(f)).sort()

if (files.length === 0) {
  console.error('✗ test/ 下没有找到任何 *.test.js')
  process.exit(1)
}

const failed = []
for (const f of files) {
  const r = spawnSync(process.execPath, [join(testDir, f)], { stdio: 'inherit' })
  if (r.status !== 0) failed.push(f)
}

console.log('')
if (failed.length > 0) {
  console.error(`✗ ${failed.length}/${files.length} 个测试文件失败：${failed.join(', ')}`)
  process.exit(1)
}
console.log(`✓ ${files.length} 个测试文件全部通过`)