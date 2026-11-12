#!/usr/bin/env node
// tests/online.mjs —— 线上字节校验
// 作用：把「线上 GitHub Pages 上的文件」跟「本地工作区里的文件」逐字节比一遍。
// 只读，不改任何东西。用途：推送后确认真的生效了；或者随时看「本地改了但还没上线」的清单。
// 用法：npm run online      只报告
//       npm run online -- --strict   有差异就以退出码 1 结束（CI 用）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SITE = process.env.SITE_URL || 'https://tcc1324.github.io/111717/';
const STRICT = process.argv.includes('--strict');
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' };

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);

// 只比「该上线的」：根目录页面 + assets 下的 css/js，跳过 .gitignore 里排除的
const ignore = new Set(
  fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
    .split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
    .map((s) => s.replace(/^\//, ''))
);
const uniq = (a) => [...new Set(a)];

function collect(dir, pred) {
  const out = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name.startsWith('.') || f.name === 'node_modules' || f.name === 'tests') continue;
    if (ignore.has(f.name)) continue;
    const p = path.join(dir, f.name);
    const rel = path.relative(ROOT, p);
    if (f.isDirectory()) out.push(...collect(p, pred));
    else if (pred(f.name)) out.push(rel);
  }
  return out;
}

const files = uniq([
  ...collect(ROOT, (n) => n.endsWith('.html')),
  ...collect(path.join(ROOT, 'assets'), (n) => /\.(js|css)$/.test(n)),
]).sort();

console.log(`${C.b}线上校验${C.x} ${SITE}${C.d} · ${files.length} 个文件${C.x}\n`);

let same = 0, diff = 0, missing = 0, err = 0;
const diffs = [];
for (const rel of files) {
  const local = fs.readFileSync(path.join(ROOT, rel));
  const url = SITE + rel.split(path.sep).join('/');
  let resp;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      resp = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
      break;
    } catch (e) {
      if (attempt === 2) {
        err++;
        console.log(` ${C.r}?${C.x} ${rel}  ${C.d}网络错误：${e.message}${C.x}`);
      } else {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }
  if (!resp) continue;
  if (resp.status === 404) {
    missing++;
    diffs.push(rel);
    console.log(` ${C.y}·${C.x} ${rel}  ${C.d}线上还没有（本地新增，未部署）${C.x}`);
    continue;
  }
  if (!resp.ok) {
    err++;
    console.log(` ${C.r}!${C.x} ${rel}  ${C.d}HTTP ${resp.status}${C.x}`);
    continue;
  }
  const remote = Buffer.from(await resp.arrayBuffer());
  if (sha(remote) === sha(local)) {
    same++;
  } else {
    diff++;
    diffs.push(rel);
    console.log(` ${C.y}≠${C.x} ${rel}  ${C.d}本地 ${sha(local)} (${local.length}B) · 线上 ${sha(remote)} (${remote.length}B)${C.x}`);
  }
}

const total = files.length;
const pct = ((same / total) * 100).toFixed(1);
console.log(`\n${C.b}──────────── 汇总 ────────────${C.x}`);
console.log(` 一致 ${C.g}${same}${C.x} · 内容不同 ${C.y}${diff}${C.x} · 线上缺失 ${C.y}${missing}${C.x} · 出错 ${C.r}${err}${C.x} · 共 ${total}（一致率 ${pct}%）`);
if (diff + missing) console.log(` ${C.d}${diff + missing} 个文件本地与线上不一致，说明「改了但还没推」${C.x}`);
else if (!err) console.log(` ${C.g}${C.b}结论：线上与本地完全一致${C.x}`);
process.exit(STRICT && (diff + missing + err) ? 1 : 0);