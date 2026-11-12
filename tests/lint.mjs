#!/usr/bin/env node
// tests/lint.mjs —— ESLint 包装器
// 为什么包一层：ESLint 装在 /root/tools（不污染项目、不进仓库），CI 上则用本地 node_modules。
// 找不到 ESLint 时**不报红**，只提示跳过，免得在没有环境的机器上误伤。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const CANDIDATES = [
  path.join(ROOT, 'node_modules', '.bin', 'eslint'),
  '/root/tools/node_modules/.bin/eslint',
];
const bin = CANDIDATES.find((p) => {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
});
if (!bin) {
  console.log('· 跳过：这台机器上没找到 ESLint（npm i -D eslint@9 后可跑）');
  process.exit(0);
}
const targets = process.argv.slice(2);
const args = (targets.length ? targets : ['assets/js', 'tests', 'eslint.config.mjs']).concat(['--color']);
const r = spawnSync(bin, args, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
console.log(r.status === 0 ? '\n✓ ESLint 通过（没有 error 级问题）' : '\n✗ ESLint 报了 error 级问题');
process.exit(r.status || 0);
