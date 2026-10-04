// 游乐园小管家「唐甜甜」：右下角气泡 + 聊天窗
// 依赖：auth.js（window.Park）、music.js（window.Music）、common.js（window.toast）
(function () {
  const SB_URL = 'https://zvuvncxdyxsgiqurkork.supabase.co';
  const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2dXZuY3hkeXhzZ2lxdXJrb3JrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5MTg4MzEsImV4cCI6MjEwNjQ5NDgzMX0.t94gMYY277tAPHo65HIctRbIRiMog-JO3Yv8tAa66aA';
  const withKey = url => url + (url.includes('?') ? '&' : '?') + 'apikey=' + encodeURIComponent(SB_ANON);

  // 内测白名单：与后端 butler 函数的 OWNERS 保持一致（只有铃心能看到唐甜甜）
  const OWNER = '5e6d4bcf-7f6d-442e-b2a8-d72e29339f75';

  const LS_HIST = 'park.butler.history';
  let history = [];
  try { history = JSON.parse(localStorage.getItem(LS_HIST)) || []; } catch {}
  function saveHist() { try { localStorage.setItem(LS_HIST, JSON.stringify(history.slice(-20))); } catch {} }
  function clearHist() { history = []; localStorage.removeItem(LS_HIST); }

  // 状态卡：告诉唐甜甜「此刻她在哪、在听什么」
  function stateCard() {
    const bits = [];
    const title = (document.title || '').trim();
    if (title) bits.push('页面「' + title + '」');
    if (window.Music) {
      const n = Music.now();
      if (n) bits.push(Music.isPlaying() ? '正在听《' + n + '》' : '上次听的歌《' + n + '》');
    }
    if (!bits.length) return '';
    return '此刻她在这座游乐园里：' + bits.join('，') + '。';
  }

  // 抓当前页面可见文字（排除管家自己的气泡和聊天窗），让唐甜甜「看」到这页有什么
  function pageText() {
    const hidden = [];
    ['butlerFab', 'butlerWin'].forEach(id => {
      const n = document.getElementById(id);
      if (n) { hidden.push(n); n.style.display = 'none'; }
    });
    let t = '';
    try { t = (document.body.innerText || '').trim(); } catch {}
    hidden.forEach(n => { n.style.display = ''; });
    return t.slice(0, 2000);
  }

  // 传给后端的完整上下文：位置状态 + 页面内容
  function context() {
    const head = stateCard();
    const body = pageText();
    const content = body ? '【当前页面上能看到的内容】' + body : '';
    if (head && content) return head + ' ' + content;
    if (head) return head;
    if (content) return content;
    return '';
  }

  async function ask(text) {
    const s = await Park.session();
    if (!s) return { ok: false, msg: '要先登录哦' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(withKey(SB_URL + '/functions/v1/butler'), {
        method: 'POST',
        headers: { apikey: SB_ANON, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, history: history.slice(-20), state: context() }),
        signal: ctrl.signal,
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok && !j.msg) j.msg = '唐甜甜好像走神了，再喊她一下试试';
      return j;
    } catch (e) {
      return { ok: false, msg: '唐甜甜好像走神了，再喊她一下试试' };
    } finally {
      clearTimeout(timer);
    }
  }

  // ===== DOM =====
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  let body = null, input = null, win = null;

  function addMsg(role, text) {
    if (!body) return;
    const row = el('div', 'butler-msg ' + role);
    if (role === 'ai') row.appendChild(el('span', 'avatar', '🍭'));
    row.appendChild(el('div', 'bubble', ''));
    row.lastChild.textContent = text;
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
    return row;
  }

  function addTyping() {
    if (!body) return;
    const row = el('div', 'butler-msg ai');
    row.appendChild(el('span', 'avatar', '🍭'));
    const b = el('div', 'bubble', '<span class="typing"><i></i><i></i><i></i></span>');
    row.appendChild(b);
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
    return row;
  }

  async function send(text) {
    text = (text || '').trim();
    if (!text) return;
    addMsg('user', text);
    history.push({ role: 'user', content: text });
    saveHist();
    input.value = '';
    const t = addTyping();
    const j = await ask(text);
    if (t) t.remove();
    if (j && j.ok && j.reply) {
      addMsg('ai', j.reply);
      history.push({ role: 'assistant', content: j.reply });
      saveHist();
    } else {
      addMsg('ai', (j && j.msg) || '唐甜甜好像走神了，再喊她一下试试');
    }
  }

  function inject() {
    // 气泡按钮
    const fab = el('div', 'butler-fab', '');
    fab.id = 'butlerFab';
    const btn = el('button', 'butler-fab__btn', '🍭');
    btn.setAttribute('aria-label', '唐甜甜');
    fab.appendChild(btn);
    fab.appendChild(el('span', 'butler-fab__dot', ''));

    // 聊天窗
    win = el('div', 'butler-win', '');
    win.id = 'butlerWin';
    win.innerHTML =
      '<div class="butler-win__head">' +
        '<div class="name">🍭 唐甜甜<span class="sub">游乐园小管家</span></div>' +
        '<button id="butlerClear" aria-label="清空对话">清空</button>' +
        '<button id="butlerClose" class="close" aria-label="关闭">×</button>' +
      '</div>' +
      '<div class="butler-win__body" id="butlerBody"></div>' +
      '<div class="butler-win__foot">' +
        '<input id="butlerInput" placeholder="想和甜甜说什么呀？" maxlength="500">' +
        '<button id="butlerSend">发送</button>' +
      '</div>';

    document.body.appendChild(fab);
    document.body.appendChild(win);

    body = document.getElementById('butlerBody');
    input = document.getElementById('butlerInput');

    btn.onclick = () => {
      win.classList.toggle('on');
      if (win.classList.contains('on')) { input.focus(); }
    };
    document.getElementById('butlerClose').onclick = () => win.classList.remove('on');
    document.getElementById('butlerClear').onclick = () => {
      clearHist(); body.innerHTML = ''; addWelcome(); toast('对话清空啦');
    };
    document.getElementById('butlerSend').onclick = () => send(input.value);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(input.value); });

    if (history.length) {
      history.forEach(m => addMsg(m.role === 'user' ? 'user' : 'ai', m.content));
    } else {
      addWelcome();
    }
  }

  function addWelcome() {
    addMsg('ai', '你好呀，我是唐甜甜～这座游乐园的灯给你留了一盏。今天想逛哪儿？');
  }

  // 解码 token 拿 uid，非白名单不显示气泡
  function uidOf(token) {
    try {
      return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub;
    } catch { return null; }
  }

  async function init() {
    if (!window.Park || typeof Park.session !== 'function') return;
    const s = await Park.session();
    if (!s) return;                       // 未登录不显示
    if (uidOf(s.access_token) !== OWNER) return;  // 内测：只有铃心能看到
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
    else inject();
  }

  init();
})();