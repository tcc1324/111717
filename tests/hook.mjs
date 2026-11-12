#!/usr/bin/env node
// tests/hook.mjs —— 「改完就查」的钩子（Claude Code 那种 Pre/Post 触发的本地等价物）
//
// 它做的事：算出这轮改了哪些文件 → 只跑受影响的那几套检查 → 30 秒内给结论 → 记下快照。
//
// 用法：
//   node tests/hook.mjs            跑一次（跟上次快照比，没改动就说没改动）
//   node tests/hook.mjs --force    忽略快照，按「全量受影响的套件」跑
//   node tests/hook.mjs --watch    常驻看门狗：每 15 秒扫一次，一变就查（Ctrl+C 停）
//   node tests/hook.mjs --silent   只写日志，不打印（给 watch 用）
//
// 退出码：0 没问题 / 1 有问题 / 2 环境缺依赖
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './checks.mjs';

const STATE = path.join(ROOT, '.ai', 'hook-state.json');
const LOG = path.join(ROOT, '.ai', 'hook-log.txt');
const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);

// ── 要盯哪些文件 ─────────────────────────────────────────────
function watchList() {
  const out = [];
  const push = (p) => {
    try {
      const st = fs.statSync(p);
      if (st.isFile()) out.push({ rel: path.relative(ROOT, p), size: st.size, mtime: Math.round(st.mtimeMs) });
    } catch { /* 不存在就算了 */ }
  };
  const walk = (dir, filter) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'baseline' || e.name === 'current' || e.name === 'diff') continue;
        walk(p, filter);
      } else if (filter(e.name)) push(p);
    }
  };
  // 根目录页面 + 后台函数（supabase/ 不上传，但改它也得查）
  walk(ROOT, (n) => n.endsWith('.html'));
  walk(path.join(ROOT, 'assets'), (n) => /\.(js|css)$/.test(n));
  walk(path.join(ROOT, 'supabase'), (n) => n.endsWith('.sql'));
  walk(path.join(ROOT, 'tests'), (n) => n.endsWith('.mjs') || n.endsWith('.py') || n.endsWith('.json'));
  walk(path.join(ROOT, '.github'), (n) => n.endsWith('.yml') || n.endsWith('.yaml'));
  for (const p of ['package.json', 'eslint.config.mjs', '.gitignore']) push(path.join(ROOT, p));
  return out;
}

function fingerprint(list) {
  const map = {};
  for (const f of list) map[f.rel] = `${f.size}:${f.mtime}`;
  return map;
}

// ── 改动 → 该跑哪些套件 ─────────────────────────────────────
function plan(changed) {
  const want = new Set();
  const add = (...ids) => ids.forEach((i) => want.add(i));
  const addBackend = () => want.add('backend');
  const addSecrets = () => want.add('secrets');
  const addLint = () => want.add('lint-js');

  for (const rel of changed) {
    if (rel.endsWith('.html')) add('syntax', 'html', 'links', 'version', 'guard', 'smoke');
    else if (/^assets\/js\/.*\.js$/.test(rel)) add('syntax', 'smoke', 'lint-js');
    else if (/^assets\/css\/.*\.css$/.test(rel)) add('css');
    else if (/^supabase\/.*\.sql$/.test(rel)) { addBackend(); addSecrets(); }
    else if (/^tests\/.*\.(mjs|py)$/.test(rel)) add('syntax');
    else if (/^\.github\/.*\.ya?ml$/.test(rel)) want.add('yaml');
    else if (rel === 'eslint.config.mjs') addLint();
    else if (rel === '.gitignore') add('links');
    else if (rel === 'package.json') add('syntax');
  }
  // 兜底：什么都没匹配上，至少查一遍语法
  if (!want.size) add('syntax');
  return [...want];
}

// ── 跑 ──────────────────────────────────────────────────────
function runSection(ids, silent) {
  const runIds = ids.filter((i) => !['backend', 'secrets', 'lint-js', 'yaml'].includes(i));
  const results = [];
  const sh = (cmd, args, label) => {
    const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
    const ok = r.status === 0;
    if (!silent && r.stdout) process.stdout.write(r.stdout);
    if (!ok && !silent && r.stderr) process.stderr.write(r.stderr);
    results.push({ label, ok, code: r.status });
    return ok;
  };
  if (runIds.length) sh(process.execPath, ['tests/run.mjs', `--only=${runIds.join(',')}`], '页面/脚本检查');
  if (ids.includes('lint-js')) sh(process.execPath, ['tests/lint.mjs'], 'ESLint（防手滑）');
  if (ids.includes('secrets')) sh(process.execPath, ['tests/secrets.mjs'], '密钥扫描');
  if (ids.includes('backend')) sh(process.execPath, ['tests/backend.mjs'], '后端只读体检');
  if (ids.includes('yaml')) {
    const r = spawnSync('python3', ['-c', 'import sys,yaml;yaml.safe_load(open(sys.argv[1],encoding="utf-8"))', '.github/workflows/quality.yml'], { cwd: ROOT });
    results.push({ label: 'workflow YAML 合法', ok: r.status === 0, code: r.status });
  }
  return results;
}

function logLine(s) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, s + '\n');
  } catch { /* 日志写不进去也不影响判断 */ }
}

function oneRound({ silent = false, force = false } = {}) {
  const list = watchList();
  const now = fingerprint(list);
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(STATE, 'utf8')).files || {}; } catch { /* 第一次跑 */ }
  const changed = list.filter((f) => force || prev[f.rel] !== now[f.rel]).map((f) => f.rel);
  const ts = new Date().toLocaleString('zh-CN', { hour12: false });

  if (!changed.length) {
    if (!silent) console.log(`\x1b[2m[${ts}] 没有改动，跳过了\x1b[0m`);
    return 0;
  }
  const ids = plan(changed);
  if (!silent) {
    console.log(`\x1b[1m[${ts}] 检测到 ${changed.length} 个文件改动\x1b[0m`);
    console.log(`\x1b[2m  ${changed.slice(0, 6).join('\n  ')}${changed.length > 6 ? `\n  …等 ${changed.length} 个` : ''}\x1b[0m`);
    console.log(`\x1b[2m  受影响：${ids.join(' / ')}\x1b[0m\n`);
  }
  const results = runSection(ids, silent);
  const bad = results.filter((r) => !r.ok);
  const summary = bad.length ? `✗ ${bad.map((r) => r.label).join('、')} 有问题` : `✓ ${results.length} 项全过`;
  if (!silent) console.log(`\n\x1b[1m${bad.length ? '\x1b[31m' : '\x1b[32m'}${summary}\x1b[0m`);
  logLine(`[${ts}] 改动 ${changed.length} 个 · ${ids.join(',')} → ${summary}`);

  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  // 快照以「开始跑之前」为准；跑的过程中又被改的文件，保留旧值，让下一轮还能抓到
  const after = fingerprint(watchList());
  for (const k of Object.keys(after)) if (after[k] !== now[k]) after[k] = prev[k];
  fs.writeFileSync(STATE, JSON.stringify({ at: ts, changed, ids, bad: bad.map((r) => r.label), files: after }, null, 1));
  return bad.length ? 1 : 0;
}

// ── 入口 ────────────────────────────────────────────────────
if (has('--watch')) {
  console.log('\x1b[1m看门狗已开：每 15 秒扫一次，文件一变就查。Ctrl+C 停。\x1b[0m');
  console.log('\x1b[2m（这个进程一关就停了；手机重启后需要重新起。日志在 .ai/hook-log.txt）\x1b[0m\n');
  oneRound({ force: true });
  let last = 0;
  setInterval(() => {
    const code = oneRound({ silent: true });
    if (code) console.log(`\x1b[31m[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 有问题，见 .ai/hook-log.txt\x1b[0m`);
  }, 15000);
  // 首次全量后重置快照时间戳，避免 watch 每轮重复报同一批
  void last;
} else {
  process.exit(oneRound({ force: has('--force'), silent: has('--silent') }));
}
