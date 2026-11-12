#!/usr/bin/env node
// tests/backend.mjs —— 后端体检（Supabase）。默认**只读**：只查结构、只做匿名读、只对账。
// 用法：
//   npm run backend              体检，并与 .ai/backend-baseline.json 比对授权变化
//   npm run backend:baseline     把当前授权/策略状态收成新基线（你确认改动是有意的时候用）
// 凭据从 ~/.ourworld/env 读（SB_REF / SB_PAT / SB_URL / SB_ANON），该文件不在上传名单里
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ROOT } from './checks.mjs';

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const results = [];
const ok = (name, msg = '') => results.push({ l: 'pass', name, msg });
const bad = (name, msg = '') => results.push({ l: 'fail', name, msg });
const warn = (name, msg = '') => results.push({ l: 'warn', name, msg });
const skip = (name, msg = '') => results.push({ l: 'skip', name, msg });

function loadEnv() {
  const p = path.join(os.homedir(), '.ourworld', 'env');
  if (!fs.existsSync(p)) return null;
  const env = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    let [k, v] = s.split('=');
    k = k.trim().replace(/^export\s+/, '');
    env[k] = v.trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}
const ENV = (() => {
  const e = loadEnv() || {};
  // CI 里没有 ~/.ourworld/env，改从环境变量读（GitHub Actions Secrets）
  for (const k of ['SB_REF', 'SB_PAT', 'SB_URL', 'SB_ANON']) if (!e[k] && process.env[k]) e[k] = process.env[k];
  return e;
})();
if (!ENV || !ENV.SB_REF || !ENV.SB_PAT) {
  console.error('读不到凭据：需要 ~/.ourworld/env 里的 SB_REF / SB_PAT / SB_URL / SB_ANON');
  process.exit(2);
}
const SB_URL = ENV.SB_URL || `https://${ENV.SB_REF}.supabase.co`;

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ENV.SB_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + ENV.SB_PAT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL 失败 ${r.status}: ${t.slice(0, 300)}`);
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}
const one = async (q) => (await sql(q))[0] || {};

// 未登录访客直接打 REST
async function anonRead(table, limit = 2) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?select=*&limit=${limit}`, {
    headers: { apikey: ENV.SB_ANON, Authorization: 'Bearer ' + ENV.SB_ANON },
  });
  let body = null;
  try {
    body = await r.json();
  } catch {}
  return { status: r.status, rows: Array.isArray(body) ? body.length : null };
}

const REQUIRED = {
  profiles: ['id', 'nickname', 'uid5', 'joined_at', 'moon_coins'],
  moon_ledger: ['uid', 'delta', 'balance_after'],
  post_letters: ['id', 'sender', 'recipient', 'body', 'deliver_at'],
  mw_lists: ['id', 'uid', 'name'],
  mw_staff: ['uid', 'role'],
  gate_invites: ['code_hash', 'used_by'],
};

async function checkSchema() {
  const rows = await sql(
    `select table_name, string_agg(column_name, ',') cols from information_schema.columns
     where table_schema='public' group by 1`
  );
  const map = new Map(rows.map((r) => [r.table_name, (r.cols || '').split(',')]));
  const missing = [];
  for (const [t, cols] of Object.entries(REQUIRED)) {
    if (!map.has(t)) {
      missing.push(`缺表 ${t}`);
      continue;
    }
    for (const c of cols) if (!map.get(t).includes(c)) missing.push(`${t}.${c} 不存在`);
  }
  if (missing.length) bad('结构与关键列', missing.join('；'));
  else ok('结构与关键列', `${map.size} 张表，关键 ${Object.keys(REQUIRED).length} 张的表字段齐全`);
}

async function checkRls() {
  const r = await one(
    `select count(*) total, count(*) filter (where relrowsecurity) on_ from pg_class c
     join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`
  );
  const total = Number(r.total), on_ = Number(r.on_);
  if (on_ < total) bad('RLS 覆盖', `${total} 张表里有 ${total - on_} 张没开 RLS`);
  else ok('RLS 覆盖', `${total}/${total} 张表全部开启`);
}

async function checkDefiner() {
  const rows = await sql(
    `select p.proname, has_function_privilege('anon', p.oid, 'execute') anon_ok,
            (p.proconfig is null) no_searchpath,
            position('auth.uid()' in pg_get_functiondef(p.oid)) > 0 checks_uid,
            (p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)) is_trigger,
            (regexp_replace(p.prosrc, '\\s+', ' ', 'g') ~* '\\m(insert|update|delete|truncate)\\M') writes
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.prosecdef order by 1`
  );
  const noSp = rows.filter((r) => r.no_searchpath).map((r) => r.proname);
  if (noSp.length) bad('definer 的 search_path', `未固定：${noSp.join(', ')}`);
  else ok('definer 的 search_path', `${rows.length} 个 definer 函数全部固定了 search_path`);

  const anonOk = rows.filter((r) => r.anon_ok).map((r) => r.proname);
  // 触发器函数（returns trigger / event_trigger）RPC 调不到，不算风险
  // KNOWN_ANON_WRITE：已知的、由前端页面直接调用的写库函数（market.html 行情页），
  // 暂按「接受」处理（只提醒）；将来 revoke 或加校验后可从名单删掉。
  const KNOWN_ANON_WRITE = ['index_today', 'index_close', 'index_backfill'];
  const risky = rows.filter((r) => r.anon_ok && !r.checks_uid && !r.is_trigger);
  const callable = risky.map((r) => r.proname);
  const writers = risky.filter((r) => r.writes).map((r) => r.proname);
  const newWriters = writers.filter((n) => !KNOWN_ANON_WRITE.includes(n));
  if (newWriters.length) {
    bad('匿名可调且不查身份', `新出现 ${newWriters.length} 个匿名可直调且会写库的函数：${newWriters.join(', ')}（其余：${callable.join(', ')}）`);
  } else if (risky.length) {
    warn('匿名可调且不查身份',
      `${callable.length} 个可匿名直调且不查 auth.uid()：${callable.join(', ')}` +
      (writers.length ? `（会写库：${writers.join(', ')}，已在 KNOWN 名单，建议后续加校验或 revoke）` : ''));
  } else ok('匿名可调且不查身份', '除触发器函数外没有匿名可直调又不管身份的函数');
  return { anonOk, anonNoCheck: callable };
}

async function checkPolicies() {
  const rows = await sql(
    `select c.relname t, count(p.policyname) pol from pg_class c
     join pg_namespace n on n.oid=c.relnamespace
     left join pg_policies p on p.tablename=c.relname and p.schemaname='public'
     where n.nspname='public' and c.relkind='r' group by 1 order by 1`
  );
  const map = {};
  for (const r of rows) map[r.t] = Number(r.pol);
  const zero = rows.filter((r) => Number(r.pol) === 0).length;
  ok('策略分布', `${rows.length} 张表：${zero} 张走「零策略 + RPC」，${rows.length - zero} 张带策略`);
  return map;
}

// 基线进仓库（tests/backend-baseline.json）：CI 里才能"跟上一版比"，而不是每次重新收基线
const BASE = path.join(ROOT, 'tests', 'backend-baseline.json');
function diffBaseline(snap) {
  const update = process.argv.includes('--update');
  if (update || !fs.existsSync(BASE)) {
    fs.mkdirSync(path.dirname(BASE), { recursive: true });
    fs.writeFileSync(BASE, JSON.stringify(snap, null, 2));
    ok('授权基线', `已保存（${snap.anonExec.length} 个匿名可执行函数）`);
    return;
  }
  const old = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  const adds = snap.anonExec.filter((x) => !old.anonExec.includes(x));
  const dels = old.anonExec.filter((x) => !snap.anonExec.includes(x));
  const polDiff = [];
  for (const t of Object.keys(snap.policies)) {
    const a = old.policies?.[t] ?? 0, b = snap.policies[t];
    if (a !== b) polDiff.push(`${t} 策略 ${a}→${b}`);
  }
  if (adds.length) warn('新出现的匿名可执行函数', `${adds.join(', ')}（迁移里忘了 revoke from anon？）`);
  if (dels.length) warn('匿名权限被收回', dels.join(', '));
  if (polDiff.length) warn('策略数量变化', polDiff.join('；'));
  if (!adds.length && !dels.length && !polDiff.length) ok('授权基线', '与基线一致，没有悄悄改权限');
}

const ANON_PROBE = ['profiles', 'post_letters', 'mw_settings', 'mw_history', 'drawer_items', 'wall_notes', 'moon_ledger', 'gate_invites'];
async function checkAnonRead() {
  const leaks = [];
  let fine = 0;
  for (const t of ANON_PROBE) {
    try {
      const r = await anonRead(t);
      const blocked = r.status === 401 || r.status === 403 || (r.status === 200 && r.rows === 0);
      if (blocked) fine++;
      else leaks.push(`${t} → ${r.status} 返回 ${r.rows} 行`);
    } catch {
      fine++;
    }
  }
  if (leaks.length) bad('匿名读表', leaks.join('；'));
  else ok('匿名读表', `${fine} 张敏感表对未登录访客全部为空或拒绝`);
}

async function checkCoins() {
  const r = await one(
    `select (select coalesce(sum(moon_coins),0) from profiles) wallet,
            (select coalesce(sum(balance_after),0) from moon_ledger
              where id in (select max(id) from moon_ledger group by uid)) ledger`
  );
  const w = Number(r.wallet), l = Number(r.ledger);
  if (Math.abs(w - l) > 0.001) bad('月光币对账', `钱包合计 ${w} ≠ 流水最新余额合计 ${l}`);
  else ok('月光币对账', `钱包合计 ${w} 与流水最新余额一致`);
}

async function checkInvariants() {
  const problems = [];
  const q = async (label, sqlText) => {
    const r = await one(sqlText);
    const n = Number(Object.values(r)[0]);
    if (n > 0) problems.push(`${label}：${n} 条`);
  };
  await q('uid5 不是五位数字', `select count(*) from profiles where uid5 is not null and uid5 !~ '^[0-9]{5}$'`);
  await q('信件正文超过 5000 字', `select count(*) from post_letters where length(body) > 5000`);
  await q('信件送达早于寄出', `select count(*) from post_letters where deliver_at < sent_at`);
  await q('邀请码哈希非 sha256 格式', `select count(*) from gate_invites where code_hash !~ '^[0-9a-f]{64}$'`);
  await q('月光币为负', `select count(*) from profiles where moon_coins < 0`);
  await q('uid5 重复', `select count(*) from (select uid5 from profiles group by 1 having count(*)>1) x`);
  await q('图片超过 200 张配额', `select count(*) from (select uid from mw_images group by 1 having count(*)>200) x`);
  await q('信件收件人等于自己以外的不存在用户', `select count(*) from post_letters l where not exists (select 1 from profiles p where p.id=l.recipient)`);
  if (problems.length) bad('业务不变量', problems.join('；'));
  else ok('业务不变量', 'uid5 格式与唯一、信件长度/时间/收件人、邀请码哈希、余额非负、图片配额 全部成立');
}

async function checkStorage() {
  const r = await one(`select count(*) n from pg_policies where schemaname='storage' and tablename='objects'`);
  const n = Number(r.n);
  if (n === 0) warn('存储策略', 'storage.objects 没有策略（上传/删除会被全拒）');
  else ok('存储策略', `storage.objects 有 ${n} 条策略`);
}

async function checkGate() {
  try {
    const r = await fetch(`${SB_URL}/functions/v1/gate`, {
      method: 'POST',
      headers: { apikey: ENV.SB_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: '__health_probe__' }),
    });
    const t = await r.text();
    if (r.status >= 500) bad('大门函数 gate', `返回 ${r.status}：${t.slice(0, 160)}`);
    else if (!/ok/.test(t)) warn('大门函数 gate', `返回 ${r.status}，回包不像 JSON：${t.slice(0, 120)}`);
    else ok('大门函数 gate', `在线，未知 action 会被礼貌拒绝（${r.status}）`);
  } catch (e) {
    bad('大门函数 gate', '连不上：' + String(e.message).slice(0, 120));
  }
}

function checkMigrations() {
  const dirs = [path.join(ROOT, 'supabase'), path.join(ROOT, '.ai', 'sql')].filter((d) => fs.existsSync(d));
  const files = [];
  for (const d of dirs) for (const f of fs.readdirSync(d)) if (f.endsWith('.sql')) files.push(path.join(d, f));
  if (!files.length) return skip('迁移脚本体检', '没找到 .sql 迁移文件');
  const problems = [];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    const creates = [...s.matchAll(/create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?([a-z0-9_]+)/gi)].map((m) => m[1].toLowerCase());
    for (const t of creates) {
      const hasRls = new RegExp(`alter\\s+table\\s+(?:public\\.)?${t}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(s);
      // 支持一条 revoke 同时管多张表：revoke all on public.a, public.b from ...
      const revokes = [...s.matchAll(/revoke[^;]*?\bon\s+([^;]*?)\bfrom\b/gi)].map((m) => m[1].toLowerCase()).join(',');
      const hasRevoke = new RegExp(`(?:public\\.)?\\b${t}\\b`).test(revokes);
      const hasPolicy = new RegExp(`create\\s+policy[^;]*on\\s+(?:public\\.)?${t}`, 'i').test(s);
      if (!hasRls) problems.push(`${path.basename(f)}: ${t} 建表后没 enable RLS`);
      else if (!hasRevoke && !hasPolicy) problems.push(`${path.basename(f)}: ${t} 既没 revoke 也没策略`);
    }
  }
  if (problems.length) warn('迁移脚本体检', problems.slice(0, 6).join('；') + (problems.length > 6 ? ` …共 ${problems.length} 处` : ''));
  else ok('迁移脚本体检', `${files.length} 个迁移文件里建的表都处理了 RLS/授权`);
}

// ── 主流程 ──
const t0 = Date.now();
console.log(`${C.b}后端体检${C.x} ${C.d}${SB_URL.replace('https://', '')} · 只读模式${C.x}\n`);

const steps = [
  ['结构与关键列', checkSchema],
  ['RLS 覆盖', checkRls],
  ['definer 授权面', checkDefiner],
  ['策略分布', checkPolicies],
  ['匿名读表', checkAnonRead],
  ['月光币对账', checkCoins],
  ['业务不变量', checkInvariants],
  ['存储策略', checkStorage],
  ['大门函数', checkGate],
];
let definer = null, policies = null;
for (const [, fn] of steps) {
  const before = results.length;
  try {
    const out = await fn();
    if (out && out.anonOk) definer = out;
    if (out && typeof out === 'object' && !out.anonOk && Object.keys(out).length) policies = out;
  } catch (e) {
    bad('检查出错', String(e.message || e).slice(0, 200));
  }
  for (const r of results.slice(before)) {
    const col = { pass: C.g, fail: C.r, warn: C.y, skip: C.d }[r.l];
    const ic = { pass: '✓', fail: '✗', warn: '!', skip: '·' }[r.l];
    console.log(` ${col}${ic}${C.x} ${r.name}${r.msg ? `  ${C.d}${r.msg}${C.x}` : ''}`);
  }
}

if (definer && policies) {
  const before = results.length;
  diffBaseline({ anonExec: definer.anonOk, anonNoCheck: definer.anonNoCheck, policies });
  const r = results[before];
  if (r) {
    const col = { pass: C.g, fail: C.r, warn: C.y, skip: C.d }[r.l];
    const ic = { pass: '✓', fail: '✗', warn: '!', skip: '·' }[r.l];
    console.log(` ${col}${ic}${C.x} ${r.name}${r.msg ? `  ${C.d}${r.msg}${C.x}` : ''}`);
  }
}
{
  const before = results.length;
  checkMigrations();
  const r = results[before];
  if (r) {
    const col = { pass: C.g, fail: C.r, warn: C.y, skip: C.d }[r.l];
    const ic = { pass: '✓', fail: '✗', warn: '!', skip: '·' }[r.l];
    console.log(` ${col}${ic}${C.x} ${r.name}${r.msg ? `  ${C.d}${r.msg}${C.x}` : ''}`);
  }
}

const n = { pass: 0, fail: 0, warn: 0, skip: 0 };
for (const r of results) n[r.l]++;
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n${C.b}──────────── 汇总 ────────────${C.x}`);
console.log(` ${C.g}通过 ${n.pass}${C.x} · ${C.r}失败 ${n.fail}${C.x} · ${C.y}提醒 ${n.warn}${C.x} · ${C.d}跳过 ${n.skip}${C.x} · ${C.d}${secs}s${C.x}`);
console.log(n.fail ? ` ${C.r}${C.b}结论：后端有 ${n.fail} 处必须修${C.x}` : ` ${C.g}${C.b}结论：后端体检通过${C.x}${n.warn ? `（${n.warn} 条提醒值得看一眼）` : ''}`);
process.exit(n.fail ? 1 : 0);