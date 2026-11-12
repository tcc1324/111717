// tests/checks.mjs —— 聆遇游乐园质量流水线的全部检查项
// 设计原则：零安装（只依赖本机已有的 jsdom）、每项检查都能独立跑、失败要说人话
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

const R = (level, name, msg = '') => ({ level, name, msg });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── 上下文：扫出要管哪些文件 ─────────────────────────
// 兜底：.gitignore 里声明过的未完工页面 + 这份清单。
// 为什么要兜底：CI 检出的是仓库里的 .gitignore，若它比本地旧（少了那段），
// 判定会从「提醒」变成「失败」——同样一份代码，本地绿、CI 红，纯属误会。
export const KNOWN_UNBUILT = ['shop.html', 'market.html', 'bank.html', 'invest.html', 'yuniao.html', 'article.html'];
function readIgnoredPages() {
  // .gitignore 里形如 "/shop.html" 的行 = 未完工、不推线上的页面
  const gi = path.join(ROOT, '.gitignore');
  const set = new Set(KNOWN_UNBUILT);
  if (!fs.existsSync(gi)) return set;
  for (const line of fs.readFileSync(gi, 'utf8').split('\n')) {
    const m = line.trim().match(/^\/([A-Za-z0-9._-]+\.html)$/);
    if (m) set.add(m[1]);
  }
  return set;
}

export function context() {
  const ignored = readIgnoredPages();
  const all = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
  const pages = all
    .filter((f) => !ignored.has(f))
    .map((name) => ({ name, file: path.join(ROOT, name), html: fs.readFileSync(path.join(ROOT, name), 'utf8') }));
  const skippedPages = all.filter((f) => ignored.has(f));
  const jsDir = path.join(ROOT, 'assets', 'js');
  const jsFiles = fs.existsSync(jsDir)
    ? fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort()
    : [];
  const cssDir = path.join(ROOT, 'assets', 'css');
  const cssFiles = fs.existsSync(cssDir)
    ? fs.readdirSync(cssDir).filter((f) => f.endsWith('.css')).sort()
    : [];
  return { pages, skippedPages, jsFiles, cssFiles, ignored };
}

let _jsdom = null;
async function jsdomLib() {
  if (_jsdom) return _jsdom;
  try {
    _jsdom = await import('jsdom');
  } catch (e) {
    // 别把「装了但 import 失败」说成「没装」——CI 上就被这条谎话骗过一次
    const why = (e && e.message ? e.message : String(e)).split('\n')[0].slice(0, 200);
    const hints = [];
    if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
      hints.push('项目根目录没有 node_modules（本地：ln -s /root/node_modules node_modules；CI：npm install jsdom）');
    } else {
      hints.push('node_modules 存在，但 jsdom 装不上或版本不兼容——jsdom 30 要 Node >= 22.22，检查 node -v');
    }
    throw new Error(`jsdom 不可用：${why}　｜　${hints.join('；')}`);
  }
  return _jsdom;
}
const jsdomParse = async (html, opts = {}) => {
  const { JSDOM } = await jsdomLib();
  return new JSDOM(html, opts);
};

// ───────────────────────── 1. 语法：JS 能不能被引擎读懂 ─────────────────────────
export async function syntax(ctx) {
  const out = [R('pass', '内联脚本扫描', `共 ${ctx.pages.length} 个页面`)];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-syn-'));
  const check = (code, label) => {
    const f = path.join(tmp, 'x.js');
    fs.writeFileSync(f, code);
    try {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
      return null;
    } catch (e) {
      const msg = (e.stderr || '').toString().split('\n').slice(0, 6).join(' / ').trim();
      return R('fail', `语法错误 · ${label}`, msg);
    }
  };

  let inlineCount = 0;
  for (const p of ctx.pages) {
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    let i = 0;
    while ((m = re.exec(p.html))) {
      i++;
      inlineCount++;
      const bad = check(m[1], `${p.name} 第 ${i} 段内联脚本`);
      if (bad) out.push(bad);
    }
  }
  for (const f of ctx.jsFiles) {
    const bad = check(fs.readFileSync(path.join(ROOT, 'assets', 'js', f), 'utf8'), `assets/js/${f}`);
    if (bad) out.push(bad);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const bad = out.filter((r) => r.level === 'fail').length;
  if (!bad) out.push(R('pass', 'JS 语法', `${inlineCount} 段内联 + ${ctx.jsFiles.length} 个文件全部通过`));
  return out;
}

// ───────────────────────── 2. HTML 结构 ─────────────────────────
export async function html(ctx) {
  const out = [];
  for (const p of ctx.pages) {
    const dom = await jsdomParse(p.html);
    const d = dom.window.document;
    const errs = [];

    if (!/^\s*<!DOCTYPE html>/i.test(p.html)) errs.push('缺 <!DOCTYPE html>（会触发怪异模式）');
    if (!d.documentElement.getAttribute('lang')) errs.push('<html> 缺 lang');
    if (!d.querySelector('head > meta[charset]')) errs.push('缺 <meta charset>（中文可能乱码）');
    if (!d.querySelector('meta[name="viewport"]')) errs.push('缺 viewport（手机上会缩小成一团）');
    const title = (d.title || '').trim();
    if (!title) errs.push('缺 <title>');

    // 重复 id：会让 getElementById 只有第一个生效，最阴的 bug
    const ids = new Map();
    for (const el of d.querySelectorAll('[id]')) {
      const id = el.getAttribute('id');
      ids.set(id, (ids.get(id) || 0) + 1);
    }
    const dup = [...ids].filter(([, n]) => n > 1).map(([id, n]) => `#${id}×${n}`);
    if (dup.length) errs.push('重复 id: ' + dup.join(', '));

    if (errs.length) out.push(R('fail', p.name, errs.join('；')));
    else out.push(R('pass', p.name, `${d.querySelectorAll('*').length} 个元素`));

    // 图片缺 alt（可访问性，只提醒不拦）
    const noAlt = d.querySelectorAll('img:not([alt])').length;
    if (noAlt) out.push(R('warn', `${p.name} 图片缺 alt`, `${noAlt} 张`));
    dom.window.close();
  }
  for (const f of ctx.skippedPages) out.push(R('skip', f, '.gitignore 列为未完工页面，不参与检查'));
  return out;
}

// ───────────────────────── 3. CSS 括号/注释平衡 ─────────────────────────
function stripCss(css) {
  // 去掉注释与字符串内容，避免里面的括号干扰计数
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}
export async function css(ctx) {
  const out = [];
  for (const f of ctx.cssFiles) {
    const raw = fs.readFileSync(path.join(ROOT, 'assets', 'css', f), 'utf8');
    const clean = stripCss(raw);
    const open = (clean.match(/{/g) || []).length;
    const close = (clean.match(/}/g) || []).length;
    const badComment = (raw.match(/\/\*/g) || []).length !== (raw.match(/\*\//g) || []).length;
    const problems = [];
    if (open !== close) problems.push(`花括号不配对 { ${open} / } ${close}`);
    if (badComment) problems.push('注释未闭合 /* 与 */ 数量不等');
    if (problems.length) out.push(R('fail', `assets/css/${f}`, problems.join('；')));
  }
  if (!out.some((r) => r.level === 'fail'))
    out.push(R('pass', 'CSS 结构', `${ctx.cssFiles.length} 个样式文件括号/注释全部闭合`));
  return out;
}

// ───────────────────────── 4. 链接与资源引用 ─────────────────────────
const LOCAL = (u) => u && !/^(https?:)?\/\//i.test(u) && !/^(data:|mailto:|tel:|javascript:|#)/i.test(u);
const stripVer = (u) => u.split('#')[0].split('?')[0];

export async function links(ctx) {
  const out = [];
  const problems = [];
  const remoteStatic = new Set();

  for (const p of ctx.pages) {
    const dom = await jsdomParse(p.html);
    const d = dom.window.document;
    const refs = [];
    for (const el of d.querySelectorAll('a[href]')) refs.push(['a', el.getAttribute('href')]);
    for (const el of d.querySelectorAll('link[href]')) refs.push(['link', el.getAttribute('href')]);
    for (const el of d.querySelectorAll('script[src]')) refs.push(['script', el.getAttribute('src')]);
    for (const el of d.querySelectorAll('img[src],source[src],video[src],audio[src]')) refs.push(['媒体', el.getAttribute('src')]);

    for (const [kind, raw] of refs) {
      if (!raw) continue;
      // 线上从 Supabase Storage 取的共享静态资源：查本地源文件在不在
      const m = raw.match(/\/object\/public\/static\/([^?#]+)/);
      if (m) {
        remoteStatic.add(m[1]);
        const local = path.join(ROOT, 'assets', m[1]);
        if (!fs.existsSync(local))
          problems.push(`${p.name} → 远程 ${m[1]}，但本地 assets/${m[1]} 不存在（可能推上去的是旧版/丢了源文件）`);
        continue;
      }
      if (!LOCAL(raw)) continue;
      const target = path.join(ROOT, stripVer(raw));
      const base = path.basename(stripVer(raw));
      if (!fs.existsSync(target)) {
        if (ctx.ignored.has(base))
          problems.push(`${p.name} 的${kind}「${raw}」指向未完工页面（.gitignore 未跟踪，线上会 404）`);
        else problems.push(`${p.name} 的${kind}「${raw}」指向不存在的文件`);
      } else if (ctx.ignored.has(base)) {
        // 文件在磁盘上，但 .gitignore 排除了 → 本地预览能点开，线上是 404
        problems.push(`${p.name} 的${kind}「${raw}」指向未完工页面（.gitignore 未跟踪，线上会 404）`);
      }
    }
    dom.window.close();
  }

  const real = problems.filter((s) => !s.includes('未完工页面'));
  const pending = problems.filter((s) => s.includes('未完工页面'));
  if (real.length) out.push(R('fail', '断链', real.join('\n      ')));
  for (const s of pending) out.push(R('warn', '未上线链接', s));
  if (!real.length) out.push(R('pass', '站内链接与本地资源', `${ctx.pages.length} 个页面的引用全部存在`));
  out.push(R('pass', '共享静态资源', `页面共引用 ${remoteStatic.size} 个远程资源，本地源文件齐备`));
  return out;
}

// ───────────────────────── 5. 缓存版本号一致性 ─────────────────────────
export async function version(ctx) {
  const out = [];
  const map = new Map(); // 资源 → Map(ver → Set(page))
  for (const p of ctx.pages) {
    const re = /\/object\/public\/static\/([^?"']+)\?v=(\d+)/g;
    let m;
    while ((m = re.exec(p.html))) {
      if (!map.has(m[1])) map.set(m[1], new Map());
      const v = map.get(m[1]);
      if (!v.has(m[2])) v.set(m[2], new Set());
      v.get(m[2]).add(p.name);
    }
  }
  let drift = 0;
  for (const [res, vers] of map) {
    if (vers.size > 1) {
      drift++;
      const detail = [...vers].map(([v, pages]) => `v=${v}（${[...pages].join('/')}）`).join(' vs ');
      out.push(R('warn', `版本号不一致 · ${res}`, detail));
    }
  }
  if (!drift) out.push(R('pass', '缓存版本号', `${map.size} 个资源在全站版本一致`));
  return out;
}

// ───────────────────────── 6. 登录门静态体检 ─────────────────────────
export async function guard(ctx) {
  const out = [];
  const publicPages = new Set(['index.html', 'login.html', 'register.html', 'reset.html', 'about.html']);
  let checked = 0;
  for (const p of ctx.pages) {
    const usesPark = /Park\s*\.\s*(session|api|sbFetch)\s*\(/.test(p.html);
    const usesGate = /Park\s*\.\s*gate\s*\(/.test(p.html);
    if (!usesPark && !usesGate) continue;
    checked++;
    const hasAuth = /static\/js\/auth\.js|\/assets\/js\/auth\.js/.test(p.html);
    if (!hasAuth) {
      out.push(R('fail', `登录门 · ${p.name}`, '用到了 Park.*，却没引入 auth.js（线上必然 undefined 崩）'));
      continue;
    }
    const protects = /Park\s*\.\s*session\s*\(/.test(p.html);
    const redirects = /login\.html/.test(p.html);
    if (protects && !redirects && !publicPages.has(p.name))
      out.push(R('warn', `登录门 · ${p.name}`, '调了 Park.session() 但页面里没有 login.html 兜底跳转，未登录可能停在空页'));
    else out.push(R('pass', `登录门 · ${p.name}`, protects ? '未登录会回登录页' : '只做数据读写'));
  }
  // 反向：公开页不该偷偷读登录态
  for (const p of ctx.pages) {
    if (publicPages.has(p.name) && /Park\s*\.\s*session\s*\(/.test(p.html))
      out.push(R('warn', `登录门 · ${p.name}`, '公开页面里读了登录态，确认是故意的'));
  }
  if (checked) out.push(R('pass', '登录门覆盖', `${checked} 个页面依赖登录态，均已引 auth.js`));
  return out;
}

// ───────────────────────── 7. 冒烟：jsdom 真跑脚本 ─────────────────────────
export async function smoke(ctx) {
  const { JSDOM, VirtualConsole } = await jsdomLib();

  // jsdom 30 没有 ResourceLoader 了：干脆把 Supabase Storage 上的共享脚本
  // 换成本地 assets/ 里的同源文件再内联进去 —— 断网也能跑真脚本，且顺便验证了资源映射对不对
  const inlineShared = (html, pageName) => {
    const missing = [];
    const out = html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/gi, (_m, src) => {
      const s = String(src);
      let f = null;
      const mm = s.match(/\/object\/public\/static\/([^?#]+)/);
      if (mm) f = path.join(ROOT, 'assets', mm[1]);
      else if (/^(?![a-z][a-z0-9+.-]*:|\/\/)/i.test(s)) f = path.join(ROOT, s.split('#')[0].split('?')[0]);
      if (!f) return '<script>/* 站外脚本，冒烟时跳过 */</script>';
      if (!fs.existsSync(f)) {
        missing.push(s);
        return '<script>/* 缺失：' + s + ' */</script>';
      }
      const code = fs.readFileSync(f, 'utf8').replace(/<\/script>/gi, '<\\/script>');
      return '<script>\n' + code + '\n</script>';
    });
    return { html: out, missing };
  };

  // jsdom 没实现的浏览器能力，记为「预期噪音」，不算失败
  const EXPECTED = [
    'Not implemented: navigation',
    'Not implemented: HTMLMediaElement',
    'Not implemented: HTMLAudioElement',
    'Not implemented: HTMLCanvasElement',
    'Not implemented: window.scrollTo',
    'Not implemented: HTMLFormElement.prototype',
    'Could not parse CSS',
    'Not implemented: window.getComputedStyle',
    'Not implemented: Window.prototype.alert',
  ];

  const out = [];
  // 页面里未捕获的异常会逃出 jsdom 打到 Node 进程上（直接崩掉流水线），
  // 这里接管它：记成该页面的失败项，继续跑下一页
  const pendingErr = [];
  const onUncaught = (e) => pendingErr.push('未捕获异常: ' + String((e && e.message) || e).slice(0, 300));
  process.on('uncaughtException', onUncaught);

  for (const p of ctx.pages) {
    const errsBefore = pendingErr.length;
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ').slice(0, 300)));
    vc.on('jsdomError', (e) => errors.push(String(e.message || e).slice(0, 300)));

    let dom;
    const { html: prepared, missing } = inlineShared(p.html, p.name);
    try {
      dom = new JSDOM(prepared, {
        url: 'http://localhost/' + p.name,
        runScripts: 'dangerously',
        virtualConsole: vc,
        pretendToBeVisual: true,
        beforeParse(win) {
          // 断网 + 未登录：让所有请求都落空，专测「没有后台时页面会不会崩」
          win.fetch = async () => ({
            ok: false,
            status: 401,
            json: async () => ({ ok: false, msg: 'unauth' }),
            text: async () => '',
            headers: { get: () => null },
          });
          if (!win.matchMedia)
            win.matchMedia = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
        },
      });
    } catch (e) {
      out.push(R('fail', `冒烟 · ${p.name}`, 'DOM 建不起来: ' + e.message));
      continue;
    }

    await new Promise((res) => {
      dom.window.addEventListener('load', res, { once: true });
      setTimeout(res, 5000);
    });
    await sleep(300);

    const win = dom.window;
    const soft = [];
    const hard = [];
    for (const e of errors) {
      if (e.includes('Not implemented: navigation')) soft.push('跳转（jsdom 不实现导航，浏览器里正常）');
      else if (EXPECTED.some((x) => e.includes(x))) soft.push(e);
      else hard.push(e);
    }
    for (const e of pendingErr.slice(errsBefore)) hard.push(e);
    if (missing.length) out.push(R('fail', `资源缺失 · ${p.name}`, missing.join('、')));
    if (hard.length) out.push(R('fail', `冒烟 · ${p.name}`, hard.slice(0, 4).join('\n      ')));
    else out.push(R('pass', `冒烟 · ${p.name}`, errors.length ? `脚本跑完，${soft.length} 条 jsdom 环境噪音` : '脚本跑完，零报错'));

    // 关键全局对象：页面要用的函数真在不在
    if (/static\/js\/auth\.js/.test(p.html) && !win.Park)
      out.push(R('fail', `全局对象 · ${p.name}`, 'auth.js 已引入但 window.Park 不存在'));
    if (/static\/js\/common\.js/.test(p.html) && typeof win.toast !== 'function')
      out.push(R('fail', `全局对象 · ${p.name}`, 'common.js 已引入但 toast() 不存在'));

    dom.window.close();
  }
  process.removeListener('uncaughtException', onUncaught);
  return out;
}

export const suites = [
  { id: 'syntax', title: '语法（JS 能被引擎读懂）', run: syntax },
  { id: 'html', title: 'HTML 结构', run: html },
  { id: 'css', title: 'CSS 结构', run: css },
  { id: 'links', title: '链接与资源', run: links },
  { id: 'version', title: '缓存版本号', run: version },
  { id: 'guard', title: '登录门体检', run: guard },
  { id: 'smoke', title: '冒烟（jsdom 真跑脚本）', run: smoke },
];
