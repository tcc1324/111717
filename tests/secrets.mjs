#!/usr/bin/env node
// tests/secrets.mjs —— 密钥泄露扫描
// 为什么要有：这是个**公开仓库**。哪天手一滑把 service_role key、GitHub token、PAT 粘进页面，
// 就等于把数据库主钥匙挂在大门口。真正的防线是推送前扫一遍。
// 只扫 git 跟踪的文件（git ls-files），没跟踪的文件本来也上不了线。
// 允许的：anon key（pubilc key）——它天生就是给浏览器用的，里面写着 "role":"anon"。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' };

// 明确是密钥的固定前缀/结构
const HARD = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'Supabase Secret key（能绕开 RLS，绝不可进前端）'],
  [/sbp_[A-Za-z0-9]{20,}/, 'Supabase 个人访问令牌（能建表改表）'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/github_pat_[A-Za-z0-9_]{20,}/, 'GitHub fine-grained token'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, '私钥'],
  [/(?:xox[baprs]-|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16})/, '常见第三方密钥'],
];
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

// 这些文件里出现密钥字样是正常的（说明文档、扫描器自己、测试）
const SKIP = [/^tests\/secrets\.mjs$/, /\.md$/i, /^\.github\//, /^package-lock\.json$/];

function jwtRole(token) {
  try {
    let p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    p += '='.repeat((4 - (p.length % 4)) % 4);
    const json = JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
    return json.role || json.aud || '(无 role)';
  } catch {
    return null;
  }
}

const list = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
if (list.status !== 0) {
  console.log(`· 跳过：这不是 git 仓库（${(list.stderr || '').trim().split('\n')[0]}）`);
  process.exit(0);
}
const files = list.stdout.split('\n').filter(Boolean).filter((f) => !SKIP.some((re) => re.test(f)));

const hits = [];
const jwtFiles = new Set();
for (const rel of files) {
  let text;
  try {
    text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    continue; // 二进制/读不了，跳过
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const [re, why] of HARD) {
      if (re.test(line)) hits.push({ rel, line: i + 1, why, sample: line.trim().slice(0, 60) });
    }
    for (const m of line.match(JWT) || []) {
      const role = jwtRole(m);
      if (role) jwtFiles.add(rel);
      if (role === 'service_role') {
        hits.push({ rel, line: i + 1, why: 'JWT 里是 service_role（数据库主钥匙）', sample: m.slice(0, 28) + '…' });
      }
    }
  });
}

console.log(`${C.b}密钥泄露扫描${C.x} ${C.d}扫了 ${files.length} 个被 git 跟踪的文件${C.x}\n`);
if (jwtFiles.size) {
  console.log(` ${C.d}· ${jwtFiles.size} 个文件里含 JWT，已解码核对角色（anon 属正常，service_role 才拦）${C.x}`);
}

if (!hits.length) {
  console.log(`\n ${C.g}✓ 没有发现密钥泄露${C.x}`);
  console.log(` ${C.d}（anon key 是公开的，出现在前端是设计如此）${C.x}`);
  process.exit(0);
}
console.log('');
for (const h of hits) console.log(` ${C.r}✗${C.x} ${h.rel}:${h.line}  ${C.y}${h.why}${C.x}  ${C.d}${h.sample}${C.x}`);
console.log(`\n ${C.r}${C.b}拦下：${hits.length} 处疑似密钥。公开仓库一旦推上去就收不回来了，先删干净再推。${C.x}`);
process.exit(1);