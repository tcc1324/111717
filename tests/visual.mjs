#!/usr/bin/env node
// tests/visual.mjs —— 视觉回归：真浏览器截图 + 像素对比
// 用法：
//   node tests/visual.mjs               对比当前与基线（没有基线的页面只留新图）
//   node tests/visual.mjs --update      把当前截图收成新基线（你确认样子对了才用）
//   node tests/visual.mjs --only=index,login
//   node tests/visual.mjs --device=desktop
//   node tests/visual.mjs --max=1.5      允许的差异占比（%）
// 图都放 .ai/visual/（不上传），差异大时给三栏对比图 <页名>-diff.png
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ROOT, context } from './checks.mjs';

const require = createRequire(import.meta.url);
// playwright 装在 /root/pw（不在本项目里，避免把几百 MB 塞进仓库）
const PW_PATH = '/root/pw/node_modules/playwright';
let chromium;
try {
  ({ chromium } = require(PW_PATH));
} catch {
  console.error('没找到 playwright：先跑  cd /root/pw && npm i playwright && npx playwright install --with-deps chromium');
  process.exit(2);
}

const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const val = (k, d) => {
  const a = argv.find((x) => x.startsWith(k + '='));
  return a ? a.slice(k.length + 1) : d;
};
const UPDATE = has('--update');
// 阈值也能用环境变量给（CI 里不同机器渲染略有差异时可整体放宽一点）
const MAX = Number(process.env.VISUAL_MAX || val('--max', '0.5'));
const DEVICE = val('--device', 'mobile');
const only = val('--only', '') ? val('--only', '').split(',').map((s) => s.trim()).filter(Boolean) : null;

const VIEW = DEVICE === 'desktop' ? { width: 1280, height: 800, deviceScaleFactor: 1 } : { width: 390, height: 844, deviceScaleFactor: 2 };

const VIS = path.join(ROOT, '.ai', 'visual');
// 基线进仓库（tests/visual/baseline）：这样 CI 里也真能比对，换设备也能复现
const BASE = path.join(ROOT, 'tests', 'visual', 'baseline');
const CUR = path.join(VIS, 'current');
const OUT = path.join(VIS, 'diff');
for (const d of [BASE, CUR, OUT]) fs.mkdirSync(d, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(ROOT, u === '/' ? '/index.html' : u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        res.writeHead(404).end('404');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

// 需要登录的页面：塞一份假凭证，让页面渲染出「登录后」的样子
function fakeSession() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '00000000-0000-0000-0000-000000000000', exp: Math.floor(Date.now() / 1000) + 86400 })}.x`;
  return { access_token: jwt, refresh_token: 'test-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 };
}

// 冻结随机数：index.html 的星点位置是随机的，不固定就永远对不上；
// 同时暂停所有动画，避免转着的摩天轮让每次截图都不一样
const FREEZE = () => {
  let s = 1234567;
  Math.random = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  document.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = '*,*::before,*::after{animation-play-state:paused !important;caret-color:transparent !important}';
    document.head.appendChild(st);
  });
};

const MOCK_PROFILE = [{ nickname: '铃儿', uid5: '00000', joined_at: '2026-10-02T12:00:00Z', moon_coins: 0 }];

(async () => {
  const ctx = context();
  const pages = ctx.pages.filter((p) => !only || only.includes(path.basename(p.name, '.html')));
  if (!pages.length) {
    console.error('没有匹配的页面');
    process.exit(2);
  }

  const { srv, port } = await serve();
  // 优先用完整 Chromium（channel），它已经装好了；没有就退回默认（headless shell）
  const LAUNCH_ARGS = ['--font-render-hinting=none', '--disable-lcd-text', '--disable-dev-shm-usage', '--no-sandbox'];
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chromium', args: LAUNCH_ARGS });
  } catch {
    browser = await chromium.launch({ args: LAUNCH_ARGS });
  }
  const results = [];

  for (const p of pages) {
    const name = path.basename(p.name, '.html');
    const c = await browser.newContext({ viewport: { width: VIEW.width, height: VIEW.height }, deviceScaleFactor: VIEW.deviceScaleFactor, reducedMotion: 'reduce' });
    await c.addInitScript(FREEZE);
    await c.addInitScript((s) => {
      try {
        localStorage.setItem('park.session', JSON.stringify(s));
      } catch {}
    }, fakeSession());

    // 后台接口全部用假数据应答：只测布局，不连真库、不改真实数据
    // 共享静态资源（base.css / common.js / 字体…）不走去公网，直接本地应答：
    // 网络抖一下就会让字体晚到、页面高度跟着变，那是假报警，不是视觉回归
    await c.route('**/storage/v1/object/public/static/**', (route) => {
      const u = new URL(route.request().url());
      const rel = decodeURIComponent(u.pathname.split('/object/public/static/')[1] || '');
      const f = path.join(ROOT, 'assets', rel);
      if (rel && fs.existsSync(f) && fs.statSync(f).isFile()) {
        route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
      } else {
        route.fulfill({ status: 404, body: '' });
      }
    });
// 有的字体直接挂在 GitHub Pages 上（tcc1324.github.io/111717/assets/fonts/…），也拦到本地
    await c.route('**/tcc1324.github.io/**', (route) => {
      const u = new URL(route.request().url());
      const rel = decodeURIComponent(u.pathname.replace(/^\/111717\//, ''));
      const f = path.join(ROOT, rel);
      if (rel && fs.existsSync(f) && fs.statSync(f).isFile()) {
        route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
      } else {
        route.fulfill({ status: 404, body: '' });
      }
    });
    await c.route('**/rest/v1/**', (route) => {
      const url = route.request().url();
      const body = url.includes('/profiles') ? MOCK_PROFILE : [];
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await c.route('**/functions/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, msg: '（截图测试）' }) }));
    await c.route('**/auth/v1/**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"msg":"test"}' }));

    const page = await c.newPage();
    const consoleErr = [];
    page.on('pageerror', (e) => consoleErr.push(String(e.message).slice(0, 120)));
    try {
      await page.goto(`http://127.0.0.1:${port}/${p.name}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      // 等字体真正到位：先主动触发加载游园体，再等 ready
      // （只等 fonts.ready 不够——没被触发加载时它立刻就 resolve，结果截到系统字体）
      await Promise.race([
        page.evaluate(async () => {
          if (!document.fonts) return;
          await document.fonts.ready;
          try {
            await document.fonts.load('20px "HanyiYouYuan"', '游玩书店个人寄');
          } catch {}
          try {
            await document.fonts.load('16px "WeiDu"', '书页');
          } catch {}
          await document.fonts.ready;
        }),
        // 字体加载万一悬挂（404、拦截没命中），绝不把整条线拖死
        new Promise((r) => setTimeout(r, 3000)),
      ]).catch(() => {});
      // 再等网络安静（页面有音乐球轮询时等不到，超时就算了），最后给渲染一点时间
      await page.waitForLoadState('networkidle', { timeout: 1200 }).catch(() => {});
      await page.waitForTimeout(900);
      const cur = path.join(CUR, `${name}.png`);
      await page.screenshot({ path: cur, fullPage: true, animations: 'disabled' });
      const base = path.join(BASE, `${name}.png`);

      if (UPDATE || !fs.existsSync(base)) {
        if (UPDATE) fs.copyFileSync(cur, base);
        results.push({ page: p.name, level: UPDATE ? 'base' : 'new', msg: UPDATE ? '基线已更新' : '首次生成，暂无基线可对比' });
      } else {
        const diffPath = path.join(OUT, `${name}-diff.png`);
        const r = spawnSync('python3', [path.join(ROOT, 'tests', 'visual_diff.py'), base, cur, '--out', diffPath, '--max', String(MAX), '--json'], { encoding: 'utf8' });
        let j = null;
        try {
          j = JSON.parse((r.stdout || '').trim().split('\n').pop());
        } catch {}
        if (!j) {
          results.push({ page: p.name, level: 'fail', msg: '对比失败：' + (r.stderr || r.stdout || '').slice(0, 160) });
        } else if (j.ok) {
          results.push({ page: p.name, level: 'pass', msg: `差异 ${j.diff_percent}%`, diff: j });
          fs.rmSync(diffPath, { force: true });
        } else {
          results.push({
            page: p.name,
            level: 'fail',
            msg: `差异 ${j.diff_percent}%（阈值 ${MAX}%）${j.size_same ? '' : ` 尺寸 ${j.size_base.join('×')} → ${j.size_cur.join('×')}`}`,
            diff: j,
            diffPath,
          });
        }
      }
      if (consoleErr.length) results.push({ page: p.name, level: 'warn', msg: '页面报错：' + consoleErr.slice(0, 2).join(' | ') });
    } catch (e) {
      results.push({ page: p.name, level: 'fail', msg: '截图失败：' + String(e.message).slice(0, 160) });
    }
    await c.close();
  }

  await browser.close();
  srv.close();

  const tag = { pass: '\x1b[32m✓\x1b[0m', fail: '\x1b[31m✗\x1b[0m', warn: '\x1b[33m!\x1b[0m', base: '\x1b[36m▣\x1b[0m', new: '\x1b[36m+\x1b[0m' };
  console.log(`\x1b[1m视觉回归${UPDATE ? '（更新基线）' : ''}\x1b[0m \x1b[2m${VIEW.width}×${VIEW.height} @${VIEW.deviceScaleFactor}x · ${pages.length} 页\x1b[0m\n`);
  for (const r of results) console.log(` ${tag[r.level]} ${r.page}  \x1b[2m${r.msg}\x1b[0m`);
  const fail = results.filter((r) => r.level === 'fail').length;
  console.log(fail ? `\n\x1b[31m结论：${fail} 页视觉有变化，图在 .ai/visual/（确认好看就用 --update 收成新基线）\x1b[0m` : '\n\x1b[32m结论：视觉与基线一致\x1b[0m');
  process.exit(fail ? 1 : 0);
})();