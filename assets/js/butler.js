// 游乐园小管家「唐甜甜」：右下角气泡 + 聊天窗
// 依赖：auth.js（window.Park）、music.js（window.Music）、common.js（window.toast）
(function () {
  const SB_URL = 'https://zvuvncxdyxsgiqurkork.supabase.co';
  const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2dXZuY3hkeXhzZ2lxdXJrb3JrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5MTg4MzEsImV4cCI6MjEwNjQ5NDgzMX0.t94gMYY277tAPHo65HIctRbIRiMog-JO3Yv8tAa66aA';
  const withKey = url => url + (url.includes('?') ? '&' : '?') + 'apikey=' + encodeURIComponent(SB_ANON);

  // 内测白名单：与后端 butler 函数的 OWNERS 保持一致（只有铃心能看到唐甜甜）
  const OWNER = '5e6d4bcf-7f6d-442e-b2a8-d72e29339f75';
  const LISTENING = '9e48693c-a8fb-42d8-8929-917bb7c18223'; // 聆遇（调满意后放开）
  let who = ''; // 当前用户的名字（铃心 / 聆遇），登录后确定

  const LS_HIST = 'park.butler.history';
  let history = [];
  try { history = JSON.parse(localStorage.getItem(LS_HIST)) || []; } catch {}
  function saveHist() { try { localStorage.setItem(LS_HIST, JSON.stringify(history.slice(-20))); } catch {} }
  function clearHist() { history = []; localStorage.removeItem(LS_HIST); }

  // 状态卡：告诉唐甜甜「此刻她在哪、在听什么」
  function stateCard() {
    const bits = [];
    const room = currentRoom();
    if (room) bits.push('在「' + room + '」');
    if (window.Music) {
      const n = Music.now();
      if (n) bits.push(Music.isPlaying() ? '正在听《' + n + '》' : '上次听的歌《' + n + '》');
    }
    if (!bits.length) return '';
    return '此刻' + (who || '她') + '在这座游乐园里：' + bits.join('，') + '。';
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

  // 把当前页面截成图片（截图前藏掉管家自己的气泡和聊天窗），转成 base64 dataURL 给唐甜甜「看」
  async function captureImage() {
    if (typeof html2canvas !== 'function') return '';
    const hidden = [];
    ['butlerFab', 'butlerWin'].forEach(id => {
      const n = document.getElementById(id);
      if (n) { hidden.push(n); n.style.display = 'none'; }
    });
    let dataUrl = '';
    try {
      const canvas = await html2canvas(document.body, {
        scale: 0.5,
        useCORS: true,
        logging: false,
        height: window.innerHeight,
        windowHeight: window.innerHeight,
      });
      dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    } catch {}
    hidden.forEach(n => { n.style.display = ''; });
    return dataUrl;
  }

  // 全站房间清单（动态站点地图的数据源）：加新房间只需在这里加一行、push 即可，不用改后端提示词
  const SITE = [
    ['park.html',        '主界面',     '游乐园大门，通往「游玩」「个人」「书店」，右下角是音乐小屋'],
    ['play.html',        '游玩·目录',  '列着：寄、留言墙(筹备中)、秘密抽屉(筹备中)'],
    ['ji.html',          '寄',         '写信的起点，通往「信箱」「投寄」「邮局」「集邮册」'],
    ['mailbox.html',     '信箱',       '收信、回信'],
    ['send.html',        '投寄',       '写一封信寄出去'],
    ['post-office.html', '邮局',       '领邮票、做邮票'],
    ['album.html',       '集邮册',     '看她收集的照片'],
    ['music-house.html', '音乐小屋',   '听歌、换颜色'],
    ['me.html',          '个人',       '她的小角落'],
    ['shop.html',        '书店',       '（页面还没建好，导航里是个空位）'],
  ];

  // 当前页面对应地图里的哪个房间（用文件名匹配 SITE，保证状态卡和地图用同一套名字）
  function currentRoom() {
    const file = (location.pathname.split('/').pop() || '').toLowerCase();
    const hit = SITE.find(r => r[0].toLowerCase() === file);
    return hit ? hit[1] : '';
  }

  // 把全站地图序列化成一段文字，随上下文发给唐甜甜，让她始终清楚游乐园有哪些房间
  function siteMap() {
    const lines = SITE.map(r => '· ' + r[1] + '（' + r[0] + '）' + r[2]);
    return '【游乐园全站地图】\n' + lines.join('\n');
  }

  // 传给后端的完整上下文：全站地图 + 位置状态 + 当前页内容
  function context() {
    const map = siteMap();
    const head = stateCard();
    const body = pageText();
    const content = body ? '【当前页面上能看到的内容】' + body : '';
    return [map, head, content].filter(Boolean).join('\n\n');
  }

  async function ask(text) {
    const s = await Park.session();
    if (!s) return { ok: false, msg: '要先登录哦' };
    const image = await captureImage();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(withKey(SB_URL + '/functions/v1/butler'), {
        method: 'POST',
        headers: { apikey: SB_ANON, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, history: history.slice(-20), state: context(), image }),
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

  // 联系总后台 AI：把诉求写进诉求表，总后台 AI 每天九点自检处理
  async function contactBackend(text) {
    const s = await Park.session();
    if (!s) return { ok: false, msg: '要先登录哦' };
    const uid = uidOf(s.access_token);
    if (!uid) return { ok: false, msg: '登录状态有点怪，重登试试' };
    try {
      const r = await fetch(withKey(SB_URL + '/rest/v1/butler_requests'), {
        method: 'POST',
        headers: {
          apikey: SB_ANON,
          Authorization: 'Bearer ' + s.access_token,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ from_uid: uid, content: text, status: 'pending' }),
      });
      return r.ok ? { ok: true } : { ok: false, msg: '没送出去，稍后再试' };
    } catch {
      return { ok: false, msg: '没送出去，稍后再试' };
    }
  }

  function openBackend() {
    const t = prompt('您可以使用此选项让甜甜帮忙联系到有乐园管理权限的总后台AI，甜甜作为中间人帮你们传话，您可以询问后台数据情况、提出乐园的修建请求或建议等，不需要通过其他人。但请注意后台AI每天晚上九点（您可提出修改）自检一次，需要时间才能给出答复。\n\n想对总后台 AI 说什么？');
    if (!t || !t.trim()) return;
    contactBackend(t.trim()).then(j => {
      if (j.ok) toast('已经转告总后台 AI 啦，它会定期处理');
      else toast(j.msg || '没送出去，稍后再试');
    });
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
      '<div class="butler-win__backend" style="text-align:center;padding:6px 12px;background:#fff;border-top:1px dashed rgba(0,0,0,.08);"><button id="butlerBackend" style="border:none;background:none;color:#b9a78a;font-size:12px;letter-spacing:.05em;cursor:pointer;">📮 联系总后台 AI</button></div>' +
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
    document.getElementById('butlerBackend').onclick = () => openBackend();
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
    const uid = uidOf(s.access_token);
    if (uid !== OWNER) return;            // 内测：只有铃心能看到（放开聆遇时把这里改成包含 LISTENING）
    who = uid === LISTENING ? '聆遇' : '铃心';
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
    else inject();
  }

  init();
})();