// dsh-health-assistant/scripts/build.mjs
// esbuild 构建：lib/index.js（host ESM）、lib/client.js（ModuleLoader bundle）
import { build } from 'esbuild'
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'

mkdirSync('lib', { recursive: true })

await build({
  entryPoints: ['src/index.js'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['@deepseek-ai/*'],
})

await build({
  entryPoints: ['src/client.js'],
  outfile: 'lib/.client.tmp.js',
  bundle: true,
  format: 'iife',
  globalName: '__healthAssistantClient',
  platform: 'browser',
  target: 'es2020',
  external: ['react'],
})

const bundle = readFileSync('lib/.client.tmp.js', 'utf8')
const wrapped =
  'window.__ModuleLoader__.load({\n' +
  '\tid: "dsh-health-assistant",\n' +
  '\tfactory: (require) => {\n' +
  bundle +
  '\n\t\treturn __healthAssistantClient.default || __healthAssistantClient;\n' +
  '\t}\n' +
  '});\n'
writeFileSync('lib/client.js', wrapped)
rmSync('lib/.client.tmp.js')

console.log('built lib/index.js, lib/client.js')