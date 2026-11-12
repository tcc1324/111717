#!/usr/bin/env node
// tests/hooks.mjs —— 把 Claude Code 的事件钩子逐个搬到本机（能做到的做，做不到的写清楚）
//
// 用法：
//   node tests/hooks.mjs list               列出全部事件与本地对应关系
//   node tests/hooks.mjs pre  <文件...>      PreToolUse：改之前先过一遍红线
//   node tests/hooks.mjs fail                PostToolUseFailure：动作失败后收尸
//   node tests/hooks.mjs session             SessionStart：开工简报
//   node tests/hooks.mjs stop                Stop：收尾时查有没有「改了没验」
//   node tests/hooks.mjs compact             PreCompact/PostCompact：写上下文锚点
//   node tests/hooks.mjs end                 SessionEnd：记一条会话小结
//
// 退出码：0 正常 / 1 有需要处理的事 / 2 被拦下（红线）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './checks.mjs';

const A = (n) => `\x1b[${n}m`;
const R = A(0);
const AI = path.join(ROOT, '.ai');
const STATE = path.join(AI, 'hook-state.json');
const LOG = path.join(AI, 'hook-log.txt');
const FAILS = path.join(AI, 'hook-failures.txt');
const ANCHOR = path.join(AI, 'context-anchor.md');
const SESSIONS = path.join(AI, 'session-log.txt');
const argv = process.argv.slice(2);
const cmd = argv[0] || 'list';

const read = (p, d = '') => { try { return fs.readFileSync(p, 'utf8'); } catch { return d; } };
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const append = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, s); };
const now = () => new Date().toLocaleString('zh-CN', { hour12: false });
const git = (args) => { const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }); return (r.stdout || '').trim(); };

// ── 事件全表（Claude Code 2026 官方清单 → 本地对应） ──────────────
const EVENTS = [
  ['PreToolUse', '工具执行前', '自制等价', 'hooks.mjs pre <文件>：命中密钥/基线/线上页面就提醒或拦下', '真拦截做不到（Operit 不给工具层钩子），靠我改前先跑'],
  ['PostToolUse', '工具成功后', '已实现', 'hook.mjs：改动指纹 → 只跑受影响套件', '最实用的一条'],
  ['PostToolUseFailure', '工具失败后', '已实现', 'hooks.mjs fail：记失败现场 + 给排查方向', ''],
  ['PostToolBatch', '并行工具批次后', '已实现', '同一入口：一次改多个文件后跑一次 hook.mjs 即可', '批量改动只需一次检查'],
  ['PermissionRequest', '权限询问前', '不适用', '—', 'Operit 没有权限弹窗这一层'],
  ['PermissionDenied', '权限被拒后', '不适用', '—', '同上'],
  ['UserPromptSubmit', '用户消息提交前', '不适用', '—', '消息直接进模型，没有可拦截的入口'],
  ['UserPromptExpansion', '斜杠命令展开', '不适用', '—', '没有斜杠命令体系'],
  ['Elicitation', 'MCP 追问前', '不适用', '—', '没有 MCP elicitation'],
  ['ElicitationResult', 'MCP 追问后', '不适用', '—', '同上'],
  ['Stop', '一轮回答结束', '自制等价', 'hooks.mjs stop：有「改了没验」就提醒', '不能真阻止我停，只能提醒我别停'],
  ['StopFailure', '因 API 错误结束', '不适用', '—', '错误由平台处理'],
  ['SubagentStart', '子代理启动', '不适用', '—', '本环境没有可用的子代理机制'],
  ['SubagentStop', '子代理结束', '不适用', '—', '同上'],
  ['TeammateIdle', '多代理队友空闲', '不适用', '—', '同上'],
  ['TaskCreated', '任务创建', '不适用', '—', '没有任务队列'],
  ['TaskCompleted', '任务完成', '不适用', '—', '同上'],
  ['PreCompact', '上下文压缩前', '自制等价', 'hooks.mjs compact：把关键状态写进 .ai/context-anchor.md', '压缩由平台触发，我拦不到，只能提前留锚点'],
  ['PostCompact', '压缩完成后', '自制等价', '同上（同一个锚点文件，随时可读）', ''],
  ['InstructionsLoaded', '规则载入后', '不适用', '—', '提示词由平台拼装'],
  ['SessionStart', '会话开始', '自制等价', 'hooks.mjs session：开工简报（上次检查结果/未通过项/待办）', '得我主动跑'],
  ['SessionEnd', '会话结束', '自制等价', 'hooks.mjs end：追加一条会话小结', '同上'],
  ['PostSession', '会话释放后', '不适用', '—', '—'],
  ['Setup', '初始化/维护', '不适用', '—', '没有 --init 这类流程'],
  ['FileChanged', '监视的文件变化', '已实现', 'hook.mjs --watch：15 秒轮询，变了就查', '注意方向相反：这套是轮询不是事件'],
  ['CwdChanged', '工作目录切换', '不适用', '—', '工作区固定'],
  ['DirectoryAdded', '新增目录', '不适用', '—', '—'],
  ['WorktreeCreate', '创建 worktree', '不适用', '—', '本地 git 与线上分叉，不用 worktree'],
  ['WorktreeRemove', '移除 worktree', '不适用', '—', '—'],
  ['ConfigChange', '配置变更', '自制等价', 'hook.mjs 已覆盖：改 .github/、eslint 配置、package.json 都会触发对应检查', ''],
  ['Notification', '通知', '不适用', '—', '没有通知通道（要提醒就用 moodlet 卡片）'],
  ['MessageDisplay', '回答显示时', '不适用', '—', '回答由平台渲染'],
];

// ── PreToolUse 等价：改之前的红线清单 ─────────────────────────
const DENY = [
  [/^node_modules\//, 'node_modules 是软链到 /root，改它没意义'],
  [/^\.git\//, '不要手动改 .git 里的东西'],
  [/^\.ai\/env\.secret$/, '这是密钥备份文件，禁止改动'],
];
const WARN = [
  [/^assets\/js\//, '线上 JS：改完必须让铃儿预览通过才推'],
  [/^assets\/css\//, '线上样式：改完要预览'],
  [/^[^/]+\.html$/, '线上页面：改完必须让铃儿预览通过才推'],
  [/^tests\/visual\/baseline\//, '视觉基线：只有确认变好才更新，更新要说明原因'],
  [/^(\.ai\/PROJECT_NOTES\.md)$/, '笔记很大：只能追加，绝不能 open("w") 整份重写'],
  [/^supabase\//, '后台 SQL 不进仓库，改完要单独在 Supabase 上执行'],
  [/^(package\.json|eslint\.config\.mjs)$/, '改了会让 CI 行为变化，推之前本地跑一遍 npm run check:offline'],
  [/^\.github\//, 'workflow 改动：推之前先 python3 -c "yaml.safe_load" 验一遍'],
];

function pre(files) {
  if (!files.length) { console.log('用法：node tests/hooks.mjs pre <文件路径>...'); return 0; }
  let blocked = 0;
  console.log(`${A(1)}改之前过一遍红线${R}  ${A(2)}（PreToolUse 的等价物）${R}\n`);
  for (const f of files) {
    const rel = path.relative(ROOT, path.isAbsolute(f) ? f : path.join(ROOT, f)).split(path.sep).join('/');
    const abs = path.join(ROOT, rel);
    const tags = [];
    for (const [re, why] of DENY) if (re.test(rel)) tags.push(['拒绝', why]);
    for (const [re, why] of WARN) if (re.test(rel)) tags.push(['注意', why]);
    let size = 0;
    try { size = fs.statSync(abs).size; } catch { if (!DENY.some(([re]) => re.test(rel))) tags.push(['新建', '这个文件还不存在，会按新建处理']); }
    if (size > 200 * 1024) tags.push(['注意', `文件 ${(size / 1024).toFixed(0)}KB，很大：改动要小而准，别整份重写`]);
    if (rel.endsWith('.json') && rel.startsWith('tests/')) tags.push(['注意', '测试基线/配置：改了等于改判定标准，要说明理由']);

    const deny = tags.filter((t) => t[0] === '拒绝');
    console.log(` ${deny.length ? A(31) + '✗' + R : A(32) + '✓' + R} ${rel}`);
    for (const [k, why] of tags) console.log(`    ${k === '拒绝' ? A(31) : k === '注意' ? A(33) : A(36)}${k}${R}  ${why}`);
    if (deny.length) blocked++;
  }
  if (blocked) { console.log(`\n${A(31)}${blocked} 个文件被拦下，不要动。${R}`); return 2; }
  console.log(`\n${A(32)}可以动手。改完记得跑：npm run hook${R}`);
  return 0;
}

// ── PostToolUseFailure 等价 ─────────────────────────────────
function fail() {
  const tail = read(LOG).trim().split('\n').slice(-5).join('\n') || '（还没有日志）';
  const body = `[${now()}] 一次动作失败了。最近日志：\n${tail}\n`;
  append(FAILS, body);
  console.log(`${A(1)}失败现场已记录${R} → ${A(2)}.ai/hook-failures.txt${R}\n`);
  console.log(`${A(2)}最近 5 条检查记录：${R}\n${tail}\n`);
  console.log(`${A(1)}下一步建议${R}`);
  console.log(' 1. 先看真实报错，不要靠猜（重复同一个失败调用超过两次就停下来找原因）');
  console.log(' 2. 路径类错误：read_file/edit_file 的参数是 path，不是 file_path');
  console.log(' 3. 改文件类错误：先 read 一遍再 edit，快照陈旧会报 could not find match');
  console.log(' 4. 终端输出被吞：用 python3 -c "print(repr(open(...).read()))" 验证真实内容');
  return 1;
}

// ── SessionStart 等价 ───────────────────────────────────────
function session() {
  const st = (() => { try { return JSON.parse(read(STATE, '{}')); } catch { return {}; } })();
  const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean).length;
  const notes = read(path.join(AI, 'PROJECT_NOTES.md'));
  const lastHead = (notes.match(/^## .+$/gm) || []).slice(-1)[0] || '（没有记录）';
  console.log(`${A(1)}开工简报${R} ${A(2)}${now()}${R}\n`);
  console.log(` 工作区   ${ROOT}`);
  console.log(` 站点     https://tcc1324.github.io/111717/  ${A(2)}（仓库 tcc1324/111717，Supabase zvuvncxdyxsgiqurkork）${R}`);
  console.log(` git      ${dirty ? `${A(33)}${dirty} 项改动未提交${R}（本地与线上是两条历史，推走 API）` : '干净'}`);
  if (st.at) {
    const bad = (st.bad || []).length;
    console.log(` 上次检查 ${st.at} → ${bad ? A(31) + '✗ ' + st.bad.join('、') + ' 有问题' + R : A(32) + '✓ 全过' + R}`);
  } else {
    console.log(` 上次检查 ${A(33)}还没跑过${R}——先 npm run hook`);
  }
  console.log(` 最后一条笔记 ${A(2)}${lastHead.replace(/^## /, '')}${R}`);
  console.log(`\n${A(2)}纪律：一次一小步 · 改完跑 npm run hook · 铃儿说「通过」才推线上${R}`);
  return 0;
}

// ── Stop 等价 ───────────────────────────────────────────────
function stopHook() {
  const r = spawnSync(process.execPath, ['tests/hook.mjs', '--silent'], { cwd: ROOT, encoding: 'utf8' });
  const code = r.status;
  const st = (() => { try { return JSON.parse(read(STATE, '{}')); } catch { return {}; } })();
  if (code === 0) { if (!argv.includes('--quiet')) console.log(`${A(32)}可以收工：刚改的东西都验过了${R}`); return 0; }
  console.log(`${A(31)}停一下：刚改的东西没过检查${R}`);
  if ((st.bad || []).length) console.log(`  没过的是：${st.bad.join('、')}`);
  console.log(`  要么修，要么在回答里明说「这条没过」再继续。`);
  return 1;
}

// ── PreCompact / PostCompact 等价 ──────────────────────────
function compact() {
  const st = (() => { try { return JSON.parse(read(STATE, '{}')); } catch { return {}; } })();
  const body = `# 上下文锚点（压缩后看这里）

生成于 ${now()}

## 项目一句话
「给聆遇的游乐园」——铃儿给笔友做的网站，GitHub Pages \`https://tcc1324.github.io/111717/\`，后台 Supabase \`zvuvncxdyxsgiqurkork\`。

## 关键路径
- 工作区：\`${ROOT}\`
- 测试设施：\`tests/\`（run/checks/visual/backend/secrets/online/lint/hook/hooks）
- CI：\`.github/workflows/quality.yml\`（四道闸门：静态+冒烟+密钥 / 后端体检 / 线上校验 / 视觉回归）
- 凭据：\`~/.ourworld/env\`（不上传）
- 笔记：\`.ai/PROJECT_NOTES.md\`

## 最近状态
- 上次检查：${st.at || '未跑'} → ${(st.bad || []).length ? '✗ ' + st.bad.join('、') : '✓ 全过'}
- 上次改动：${(st.changed || []).slice(0, 6).join(', ') || '无'}

## 必须记住的纪律
1. 一次一小步，改完告诉铃儿改了哪里、怎么预览
2. 铃儿说「通过」才推线上
3. 推送走 GitHub API（\`.ai/api/push_tests.mjs\` / \`push_fix.mjs\`），不要 \`git push\`（本地与线上是两条历史）
4. 页面文件最小改动，不整份覆盖
`;
  write(ANCHOR, body);
  console.log(`${A(1)}上下文锚点已写入${R} → ${A(2)}.ai/context-anchor.md${R}`);
  console.log(`${A(2)}压缩之后可以让我读它恢复状态${R}`);
  return 0;
}

// ── SessionEnd 等价 ─────────────────────────────────────────
function end() {
  const st = (() => { try { return JSON.parse(read(STATE, '{}')); } catch { return {}; } })();
  const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean).length;
  append(SESSIONS, `[${now()}] 上次检查 ${st.at || '—'} · ${(st.bad || []).length ? '红：' + st.bad.join('、') : '绿'} · git ${dirty} 项未提交\n`);
  console.log(`${A(1)}会话小结已追加${R} → ${A(2)}.ai/session-log.txt${R}`);
  return 0;
}

// ── list ────────────────────────────────────────────────────
function list() {
  const groups = { '已实现': A(32), '自制等价': A(36), '不适用': A(2) };
  console.log(`${A(1)}Claude Code 事件钩子 → 本机对应${R}  ${A(2)}共 ${EVENTS.length} 个事件${R}\n`);
  for (const [name, when, status, impl, note] of EVENTS) {
    console.log(`${groups[status] || ''}${status.padEnd(6)}${R} ${A(1)}${name.padEnd(20)}${R} ${when}`);
    if (status !== '不适用') console.log(`         ${A(2)}${impl}${R}`);
    if (note) console.log(`         ${A(2)}↳ ${note}${R}`);
  }
  const c = (s) => EVENTS.filter((e) => e[2] === s).length;
  console.log(`\n${A(1)}合计${R}：已实现 ${c('已实现')} · 自制等价 ${c('自制等价')} · 不适用 ${c('不适用')}`);
  return 0;
}

const RUN = {
  pre: () => pre(argv.slice(1)),
  fail, session,
  stop: stopHook,
  compact, end, list,
};
const fn = RUN[cmd];
if (!fn) {
  console.log('用法：node tests/hooks.mjs [list|pre <文件>|fail|session|stop|compact|end]');
  process.exit(0);
}
process.exit(fn());