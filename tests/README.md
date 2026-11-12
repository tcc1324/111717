# tests/ —— 聆遇游乐园质量流水线

一条命令跑完所有检查，绿了才推线上。零安装（只用本机已有的 Node + jsdom）。

## 怎么跑

```bash
npm test              # 全部（约 20 秒）
npm run test:fast     # 只跑静态检查（语法/HTML/CSS/链接/版本号/登录门，约 8 秒）
npm run test:smoke    # 只跑 jsdom 冒烟
npm run lint          # 只跑语法 + HTML + CSS

node tests/run.mjs --only=links,guard   # 只跑指定套件
node tests/run.mjs --quiet              # 只打汇总
```

- 退出码：全绿 0，有 fail 1（可以 `&& git commit` 串联）。
- 报告：`.ai/test-report.json`（不在上传名单里，权限只在本机）。

**首次在新环境跑**，jsdom 需要能 require 到：`ln -s /root/node_modules node_modules`（已配好，软链已进 .gitignore）。

## 每个套件管什么

| id | 套件 | 抓的是什么真问题 |
|---|---|---|
| `syntax` | 语法 | 内联 `<script>` 与 `assets/js/*.js` 里写错的 JS（用 `node --check` 编译一遍） |
| `html` | HTML 结构 | 缺 doctype / lang / charset / viewport / title、**重复 id**、图片缺 alt |
| `css` | CSS 结构 | 花括号不配对、注释 `/*` 没闭合（少一个 `}` 会让后面半张样式表全废） |
| `links` | 链接与资源 | 站内链接指向不存在的文件、指向 .gitignore 里未上线页面（线上 404）、远程共享资源在本地没有源文件 |
| `version` | 缓存版本号 | 同一个 `?v=` 资源在不同页面版本不一致（改了 common.js 只 bump 了一半页面的典型事故） |
| `guard` | 登录门体检 | 页面用了 `Park.*` 却没引 `auth.js`；需要登录的页面没有 `login.html` 兜底跳转 |
| `smoke` | 冒烟 | jsdom 里真把脚本跑一遍：外链脚本内联回 `assets/`、`fetch` 打成 401，**专测「断网 + 未登录」时页面会不会崩**；顺带验 `window.Park` / `toast` 真存在 |

## 约定

- **未完工页面**：`.gitignore` 里写成 `/shop.html` 的页面自动跳过（当前 6 个：article、bank、invest、market、shop、yuniao），既不检查也不抱怨。等要上线时，把 `.gitignore` 那一行删掉，它就自动进入流水线。
- **失败要说人话**：每条 fail 都写清「哪个文件的哪一段、错在哪、后果是什么」，不要只抛堆栈。
- **加新检查**：在 `tests/checks.mjs` 里写一个 `export async function xxx(ctx)`，返回 `{level:'pass'|'fail'|'warn'|'skip', name, msg}` 数组，然后把它加进文件末尾的 `suites` 数组即可。
- `warn` 不拦推送（比如「指向未上线页面」这种暂时合理的），`fail` 一定拦。

## 视觉回归（截图对比）

前提：真 Chromium（`/root/pw` 下的 playwright + `chromium`，不塞进本项目仓库）。

```bash
npm run visual                 # 截图并与基线比像素，约 1~2 分钟
npm run visual:update          # 样式改对了，把当前截图收成新基线
node tests/visual.mjs --only=login,index --max=1.5 --device=desktop
```

- **怎么拍的**：起一个本地静态服务 → 390×844 @2x（手机版；`--device=desktop` 换 1280×800）→ 塞一份**假登录凭证**、把后台接口（`/rest/v1`、`/functions/v1`、`/auth/v1`）全部用假数据拦截，**不连真库、不动真实数据** → 冻结 `Math.random`（首页星点位置是随机的）、暂停所有动画（摩天轮在转）、等 `document.fonts.ready`（否则截到的是系统字体）→ 整页截图。
- **怎么比**：`tests/visual_diff.py`（Pillow）像素级对比，单通道色差容差 12 用来吃掉抗锯齿噪音，差异占比超过 0.5% 判红；尺寸变了会单独提示（很多视觉回归就是高度变了）。
- **看图**：基线 `tests/visual/baseline/`（**在仓库里**，所以 CI 里也真能比对）、本次 `.ai/visual/current/`、差异三栏图（左基线｜中当前｜右差异红标）`.ai/visual/diff/<页>-diff.png`（这两样在 `.ai/` 下，不上传）。
- **正确用法**：改完样式 → `npm run visual` → 有红就看 diff 图确认是不是想要的变化 → 想要就 `npm run visual:update` 收基线 → 再提交。**基线等于「你点头过的样子」**，别在没看图的时候随手 update。

## 后端体检（Supabase，只读）

```bash
npm run backend            # 体检 + 跟授权基线比一遍，约 20 秒
npm run backend:baseline   # 你确认「这次授权变化是有意的」之后，收成新基线（写进 tests/backend-baseline.json）
```

凭据从 `~/.ourworld/env`（`SB_REF` / `SB_PAT` / `SB_URL` / `SB_ANON`）读，CI 里则从环境变量/Secrets 读。
**这一套只读**：只查结构、只做匿名读（读不到才正常）、只对账，不改一行数据。

| 检查 | 抓的是什么 |
|---|---|
| 结构与关键列 | 关键表/列被人删了、改名了（前端会静默失败的那种） |
| RLS 覆盖 | 哪张表忘了开 RLS（等于对全网敞开） |
| definer 的 search_path | `security definer` 函数没固定 search_path（经典提权漏洞） |
| 匿名可调且不查身份 | 未登录就能直调的 definer 函数；**会写库的**重点看（触发器函数已排除，RPC 调不到） |
| 策略分布 | 「零策略 + RPC」与「带策略」各多少张，异常漂移能看出来 |
| 匿名读表 | 8 张敏感表（profiles / 信件 / 抽屉 / 月光币…）对访客必须为空或被拒 |
| 月光币对账 | `moon_ledger` 的 delta 求和 vs `profiles.moon_coins` vs 流水 `balance_after`，三方对不上就是漏记/错记 |
| 业务不变量 | uid5 格式与唯一、信件正文长度与时间先后、邀请码只存 sha256、余额非负、图片配额（200 张 / 50MB） |
| 存储策略 | `storage.objects` 的策略还在不在 |
| gate 函数 | 登录/注册网关在线；未知 action 必须被礼貌拒绝（400） |
| 授权基线 | 记下「anon 能执行哪些函数」，以后**悄悄多出**一个就报红 |
| 迁移脚本体检 | `.ai/sql/*.sql` 里 `create table` 后有没有 `enable rls` + `revoke`/`policy`（`pg_default_acl` 对 anon 默认全权，忘了 revoke 就是新洞） |

## ESLint（只防低级错误）

```bash
npm run lint:js            # error 会拦，warning 不拦
```

规则只挑了「防手滑」的那批：`no-undef`（拼错变量名）、`no-redeclare`、`no-dupe-keys`、`no-unreachable`、`no-constant-condition`、`no-fallthrough`、`use-isnan`……**不查缩进、不查引号、不查分号**，避免变成一场风格吵架。
ESLint 装在 `/root/tools`（本机工具，不进仓库）；换台机器跑会提示「跳过」而不报红。

## 线上字节校验

```bash
npm run online                 # 本地 vs 线上 GitHub Pages，逐文件 sha256
npm run online -- --strict     # 有差异就退出码 1
```

用途：① 推送后确认真的生效（Pages 有 CDN 缓存）；② 随时看「本地改了但还没上线」的清单。
当前会报出 `assets/js/music-widget.js` 本地比线上新、`assets/js/wz-db.js` 线上还没有——那是还没推的改动，属正常。

## 密钥泄露扫描

```bash
npm run secrets
```

这是个**公开仓库**。扫描 git 跟踪的文件，抓：`sb_secret_`（Supabase Secret key）、`sbp_`（Supabase PAT）、`ghp_`/`github_pat_`（GitHub token）、私钥、常见第三方 key，以及**解码 JWT 看 role**——`anon` 是公开的、正常，`service_role` 就是数据库主钥匙，一律拦。
自查过：现在仓库里 3 个文件含 JWT，全是 anon；把 service_role 塞进文件试一次，能准确报红。

## CI（.github/workflows/quality.yml）

| job | 什么时候跑 | 干什么 |
|---|---|---|
| `check` | push main / PR / 手动 | jsdom 冒烟 + 7 套件 + 密钥扫描 + ESLint；报告存 artifact |
| `backend` | push / 定时 / 手动 | 后端只读体检（需要在 GitHub 配 Secrets 才跑，不配自动跳过） |
| `online` | 定时（每天 11:17）/ 手动 | 仓库 vs 线上 Pages 逐文件 sha256，发现「部署滞后」 |
| `visual` | 手动 | 装 Chromium 截图并与 `tests/visual/baseline/` 比对（基线在仓库里，真能拦） |

其他：`permissions: contents: read`（只读）、`concurrency` 自动取消旧的重复运行、依赖版本写死、`paths-ignore` 让纯改 md 不触发。

## 不在这条线里的（还在手工/半自动）

- 真浏览器端到端点击流（登录、跳转、控制台报错）：截图那条线已经在用真 Chromium，点击流可以顺着加。
- 幂等 / 并发测试（同一请求发两遍不能扣两次币、整份覆盖写不能丢更新）：要写数据，得专门开测试账号 + 假数据，风险最高，单独决定。
- Supabase 本地栈（`supabase start`）：本机 proot 没有 docker daemon，跑不了，已放弃。
