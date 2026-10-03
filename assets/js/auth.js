// 登录状态：不引第三方库，直接和 Supabase 对话
// 这里的 anon key 本来就是公开的，权限由数据库 RLS 和后台函数把关
(function () {
  const SB_URL = 'https://zvuvncxdyxsgiqurkork.supabase.co';
  const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2dXZuY3hkeXhzZ2lxdXJrb3JrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5MTg4MzEsImV4cCI6MjEwNjQ5NDgzMX0.t94gMYY277tAPHo65HIctRbIRiMog-JO3Yv8tAa66aA';
  const KEY = 'park.session';
  // 有些手机浏览器/网络会悄悄丢掉 apikey 请求头，这里把它也放进网址参数里兜底
  const withKey = url => url + (url.includes('?') ? '&' : '?') + 'apikey=' + encodeURIComponent(SB_ANON);

  // 调后台大门函数，网络不好时给温柔的提示
  async function gate(action, data) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch(withKey(SB_URL + '/functions/v1/gate'), {
        method: 'POST',
        headers: { apikey: SB_ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data }),
        signal: ctrl.signal,
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok && !j.msg) j.msg = '出了点小状况，请稍后再试';
      return j;
    } catch (e) {
      return { ok: false, msg: '网络好像有点慢，再试一次吧' };
    } finally {
      clearTimeout(timer);
    }
  }

  const save = (s) => s && localStorage.setItem(KEY, JSON.stringify(s));
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const clear = () => localStorage.removeItem(KEY);

  // 取一个有效的登录凭证，快过期就自动续期
  // 续期锁：同一个旧凭证只发一次续期请求，避免页面里多个请求并发续期，
  // 把 refresh_token 轮换掉（Supabase 开了 refresh token rotation，旧令牌一次就失效）
  let refreshing = null;
  async function doRefresh(token) {
    try {
      const r = await fetch(withKey(SB_URL + '/auth/v1/token?grant_type=refresh_token'), {
        method: 'POST',
        headers: { apikey: SB_ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: token }),
      });
      if (!r.ok) { if (r.status < 500) clear(); return null; }
      const n = await r.json();
      const fresh = { access_token: n.access_token, refresh_token: n.refresh_token, expires_at: n.expires_at };
      save(fresh);
      return fresh;
    } catch { return null; }
  }
  async function session() {
    const s = load();
    if (!s) return null;
    if (s.expires_at * 1000 - Date.now() > 60000) return s;
    if (!refreshing) refreshing = doRefresh(s.refresh_token).finally(() => { refreshing = null; });
    return refreshing;
  }

  // 带登录身份读写数据库
  async function api(path, opts = {}) {
    const s = await session();
    if (!s) {
      // 登录凭证彻底失效了（续期也失败），跳回登录页让用户重新登录，
      // 而不是用 anon key 硬顶上去（那样调领取函数必然被数据库拒绝）
      location.replace('login.html');
      throw new Error('need-login');
    }
    return fetch(withKey(SB_URL + '/rest/v1/' + path), {
      ...opts,
      headers: { apikey: SB_ANON, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
  }

  async function logout() {
    const s = load();
    clear();
    if (s) fetch(withKey(SB_URL + '/auth/v1/logout'), { method: 'POST', headers: { apikey: SB_ANON, Authorization: 'Bearer ' + s.access_token } }).catch(() => {});
  }

  window.Park = { gate, save, session, api, logout };
})();