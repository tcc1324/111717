// eslint.config.mjs —— 只做「防低级错误」的静态检查，不搞代码风格
// 目标：抓拼写错变量、重复声明、忘写的括号、永远不成立的判断、switch 漏 case 这一类
// 运行：npm run lint:js
const browser = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly', console: 'readonly',
  fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly', requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
  Image: 'readonly', Audio: 'readonly', FormData: 'readonly', URL: 'readonly',
  URLSearchParams: 'readonly', Blob: 'readonly', File: 'readonly', FileReader: 'readonly',
  AbortController: 'readonly', crypto: 'readonly', performance: 'readonly',
  IntersectionObserver: 'readonly', MutationObserver: 'readonly', ResizeObserver: 'readonly',
  HTMLElement: 'readonly', Node: 'readonly', Event: 'readonly', CustomEvent: 'readonly',
  DOMParser: 'readonly', history: 'readonly', screen: 'readonly', CSS: 'readonly',
  matchMedia: 'readonly', atob: 'readonly', btoa: 'readonly', caches: 'readonly',
  BroadcastChannel: 'readonly', MediaMetadata: 'readonly', MediaSession: 'readonly',
  NodeFilter: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
  HTMLMediaElement: 'readonly', XMLHttpRequest: 'readonly', WebSocket: 'readonly',
  // 项目里通过 <script> 引入的全局
  supabase: 'readonly', Park: 'readonly', Ji: 'readonly', Toast: 'readonly',
  toast: 'readonly', Music: 'readonly', html2canvas: 'readonly',
};

const node = {
  process: 'readonly', console: 'readonly', Buffer: 'readonly',
  fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', AbortController: 'readonly',
};

const rules = {
  'no-undef': 'error',              // 用了没定义的名字（拼写错）
  'no-redeclare': 'error',          // 同名重复声明
  'no-dupe-keys': 'error',          // 对象里重复的键
  'no-dupe-args': 'error',          // 函数重复参数
  'no-unreachable': 'error',        // return 后面的死代码
  'no-func-assign': 'error',        // 覆盖函数声明
  'no-cond-assign': ['error', 'except-parens'],
  'no-constant-condition': ['warn', { checkLoops: false }],
  'no-duplicate-case': 'error',
  'no-fallthrough': 'warn',         // switch 漏 break
  'no-self-compare': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'eqeqeq': ['warn', 'smart'],
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-async-promise-executor': 'error',
};

export default [
  { ignores: ['node_modules/**', '.ai/**', '.git/**', 'assets/music/**', '**/*.min.js'] },
  { files: ['assets/js/**/*.js', 'assets/**/*.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: browser }, rules },
  { files: ['tests/visual.mjs'], languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...node, ...browser } }, rules },
  { files: ['**/*.mjs', 'tests/**/*.js', 'eslint.config.mjs'], languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...node, ...browser } }, rules },
];
