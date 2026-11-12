#!/usr/bin/env node
// tests/run.mjs —— 流水线调度器：跑所有套件、按层汇总、非零退出码
// 用法： node tests/run.mjs [--only=syntax,html] [--quiet] [--json=路径]
import fs from 'node:fs';
import path from 'node:path';
import { suites, context, ROOT } from './checks.mjs';

const argv = process.argv.slice(2);
const onlyArg = argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean) : null;
const quiet = argv.includes('--quiet');
const jsonArg = argv.find((a) => a.startsWith('--json='));
const jsonOut = jsonArg ? jsonArg.slice(7) : path.join(ROOT, '.ai', 'test-report.json');

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const ICON = { pass: '✓', fail: '✗', warn: '!', skip: '·' };
const COLOR = { pass: C.green, fail: C.red, warn: C.yellow, skip: C.gray };

const t0 = Date.now();
const ctx = context();
const totals = { pass: 0, fail: 0, warn: 0, skip: 0 };
const report = { at: new Date().toISOString(), pages: ctx.pages.length, suites: [] };

console.log(
  `${C.bold}聆遇游乐园 · 质量流水线${C.reset} ${C.dim}(${ctx.pages.length} 个上线页面 / ${ctx.jsFiles.length} 个 JS / ${ctx.cssFiles.length} 个 CSS)${C.reset}\n`
);

for (const s of suites) {
  if (only && !only.includes(s.id)) continue;
  const started = Date.now();
  let results;
  try {
    results = await s.run(ctx);
  } catch (e) {
    results = [{ level: 'fail', name: `${s.title} 套件本身崩了`, msg: e.message }];
  }
  const cnt = { pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const r of results) {
    cnt[r.level]++;
    totals[r.level]++;
  }
  const mark = cnt.fail ? `${C.red}✗ ${cnt.fail} 处问题${C.reset}` : cnt.warn ? `${C.yellow}! ${cnt.warn} 条提醒${C.reset}` : `${C.green}✓ 全绿${C.reset}`;
  console.log(`${C.cyan}▶ ${s.title}${C.reset}  ${mark} ${C.dim}(${Date.now() - started}ms)${C.reset}`);

  if (!quiet) {
    // 失败和提醒逐条列出；全过的套件只保留汇总行，避免刷屏
    const showDetail = results.some((r) => r.level === 'fail' || r.level === 'warn');
    for (const r of results) {
      if (r.level === 'pass' && !showDetail && results.length > 3) continue;
      if (r.level === 'pass' && results.length > 8 && only === null) continue;
      const icon = `${COLOR[r.level]}${ICON[r.level]}${C.reset}`;
      const msg = r.msg ? ` ${C.dim}${r.msg}${C.reset}` : '';
      console.log(`   ${icon} ${r.name}${msg}`);
    }
  }
  console.log('');
  report.suites.push({ id: s.id, title: s.title, ms: Date.now() - started, counts: cnt, results });
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
const ok = totals.fail === 0;
console.log(`${C.bold}──────────── 汇总 ────────────${C.reset}`);
console.log(
  ` ${C.green}通过 ${totals.pass}${C.reset} · ${C.red}失败 ${totals.fail}${C.reset} · ${C.yellow}提醒 ${totals.warn}${C.reset} · ${C.gray}跳过 ${totals.skip}${C.reset} · ${C.dim}${secs}s${C.reset}`
);
console.log(
  ok
    ? ` ${C.green}${C.bold}结论：这道闸门可以过${C.reset}${totals.warn ? `（有 ${totals.warn} 条提醒，建议看一眼）` : ''}`
    : ` ${C.red}${C.bold}结论：先别推，${totals.fail} 处必须修${C.reset}`
);

report.totals = totals;
report.seconds = Number(secs);
report.ok = ok;
try {
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  console.log(` ${C.dim}报告已存：${path.relative(ROOT, jsonOut)}${C.reset}`);
} catch {}

process.exit(ok ? 0 : 1);