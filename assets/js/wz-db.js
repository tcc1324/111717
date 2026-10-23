/* ————————————————————————————————————————————————
   文章页 ↔ Supabase 适配层
   ————————————————————————————————————————————————
   article.html 原本是给一个沙盒环境写的：数据层不在页面里，
   而是由宿主注册在 window.claude.use(...) 上，形状是 Firestore：

     cl.use('db')     → db.collection('articles').orderBy('ts','desc')
                            .limit(20).onSnapshot(cb, err)
                        db.doc('bodies/' + id).set({ html })
     cl.use('user')   → user.id() / user.me() / user.can('data.write')
                        user.profiles(ids)
     cl.use('assets') → assets.upload(blob) → { url }

   真网站上没有这个宿主，所以页面永远退回本机 localStorage。
   这里用项目现成的 Park（assets/js/auth.js，带登录态和自动续期）
   把上面三种接口接到 Supabase 的表（.ai/sql/010_wenzhang.sql）：

     articles → wz_articles      bodies  → wz_bodies
     comments → wz_comments      columns → wz_columns
     prefs    → wz_prefs         notifs  → wz_notifs
     图片      → Storage 桶 wz-img

   页面一行都不用改。必须在页面主脚本之前引入。

   实时性说明：没有走 WebSocket，用「定时问一次 + 写之后立刻问一次」，
   只在标签页可见时跑。两个人同时开着，最多 20 秒就能互相看到。
   ———————————————————————————————————————————————— */
(function () {
  if (typeof window.Park === 'undefined') return; // 没加载 auth.js 就老实待在本机模式

  const SB_URL = 'https://zvuvncxdyxsgiqurkork.supabase.co';
  const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2dXZuY3hkeXhzZ2lxdXJrb3JrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5MTg4MzEsImV4cCI6MjEwNjQ5NDgzMX0.t94gMYY277tAPHo65HIctRbIRiMog-JO3Yv8tAa66aA';
  const POLL = 20000;

  const SPLIT = p => String(p).split('/').filter(Boolean);

  // 前端字段名 ↔ 表里的列名（只写不一样的那几个）
  const FIELDS = {
    wz_articles: {},
    wz_bodies:   {},
    wz_comments: { text: 'body', replyTo: 'reply_to', toName: 'to_name' },
    wz_columns:  { desc: 'descr' },
    wz_prefs:    { favCols: 'favcols' },
    wz_notifs:   { from: 'from_uid', fromPen: 'from_pen', read: 'is_read', text: 'body' }
  };
  const PKEY = {
    wz_articles: ['id'], wz_bodies: ['id'], wz_comments: ['id'],
    wz_columns: ['id'], wz_prefs: ['uid'], wz_notifs: ['uid', 'id']
  };

  // 页面的 .set() 在 Firestore 里是「整份文档替换」，而 PostgREST 的
  // upsert 是「只改给了的列」。这个差别会真的出错：
  // 删专栏时页面把 col 这个键直接 delete 掉再 set，指望它被清空；
  // 合并语义下 col 会原地留着，文章就挂在了一个已经没有的专栏上。
  // 所以对已知表把「缺的列」补上默认值；uid/ts 这类必须由页面给的
  // 不补（缺了就当没动，保留原值，也不会被冒充）。
  const REPLACE = {
    wz_articles: { title: '', cat: '综合', tags: [], kw: [], src: null, pen: null, col: null, excerpt: '', imgs: [], wc: 0, edited: null },
    wz_bodies:   { html: '' },
    wz_comments: { body: '', parent: '', reply_to: '', to_name: null, pen: null },
    wz_columns:  { descr: '' },
    wz_prefs:    { favs: [], favcols: [], prof: null, seen: [] }
  };

  function toDb(tbl, o) {
    const f = FIELDS[tbl] || {}, r = {};
    for (const k in o) r[f[k] || k] = o[k];
    return r;
  }
  function fromDb(tbl, row) {
    const f = FIELDS[tbl] || {}, rev = {};
    for (const k in f) rev[f[k]] = k;
    const r = {};
    for (const k in row) {
      if (k === 'created_at' || k === 'updated_at') continue;
      r[rev[k] || k] = row[k];
    }
    return r;
  }

  // 路径 → 表 + 键（Firestore 那种「奇数段是集合、偶数段是文档」）
  function resolve(sg) {
    const n = sg.length, a = sg[0];
    if (a === 'articles') {
      if (n === 1) return { tbl: 'wz_articles', keys: {} };
      if (n === 2) return { tbl: 'wz_articles', keys: { id: sg[1] } };
      if (n === 3 && sg[2] === 'comments') return { tbl: 'wz_comments', keys: { aid: sg[1] } };
      if (n === 4 && sg[2] === 'comments') return { tbl: 'wz_comments', keys: { aid: sg[1], id: sg[3] } };
    }
    if (a === 'bodies' && n === 2) return { tbl: 'wz_bodies', keys: { id: sg[1] } };
    if (a === 'columns') {
      if (n === 1) return { tbl: 'wz_columns', keys: {} };
      if (n === 2) return { tbl: 'wz_columns', keys: { id: sg[1] } };
    }
    if (a === 'data' && n === 4 && sg[1] === 'users' && sg[3] === 'prefs') {
      return { tbl: 'wz_prefs', keys: { uid: sg[2] } };
    }
    if (a === 'notifs' && sg[2] === 'items') {
      if (n === 3) return { tbl: 'wz_notifs', keys: { uid: sg[1] } };
      if (n === 4) return { tbl: 'wz_notifs', keys: { uid: sg[1], id: sg[3] } };
    }
    throw new Error('不认识的数据路径：' + sg.join('/'));
  }

  function keyQuery(keys) {
    let q = '';
    for (const k in keys) q += '&' + k + '=eq.' + encodeURIComponent(keys[k]);
    return q;
  }

  async function rest(path, opts) {
    const r = await Park.api(path, opts);
    const text = await r.text().catch(() => '');
    if (!r.ok) {
      const err = new Error('数据库拒绝了这次操作（' + r.status + '）');
      err.status = r.status;
      err.detail = text.slice(0, 300);
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }

  function wrap(tbl, row) {
    return { id: row.id != null ? row.id : row.uid, exists: true, data: () => fromDb(tbl, row) };
  }

  // ———— 读 ————
  async function collGet(sg, st, sel) {
    const { tbl, keys } = resolve(sg);
    let q = 'select=' + (sel || '*') + keyQuery(keys);
    (st.filters || []).forEach(f => { q += '&' + f[0] + '=eq.' + encodeURIComponent(f[2]); });
    if (st.order) {
      const col = st.order[0];
      q += '&order=' + col + '.' + (st.order[1] === 'desc' ? 'desc' : 'asc');
      if (col !== 'id') q += ',id.asc';
    }
    if (st.limit) q += '&limit=' + st.limit;
    const rows = await rest(tbl + '?' + q);
    return (rows || []).map(r => wrap(tbl, r));
  }

  async function docGet(sg) {
    const { tbl, keys } = resolve(sg);
    const rows = await rest(tbl + '?select=*' + keyQuery(keys) + '&limit=1');
    const row = rows && rows[0];
    return { exists: !!row, id: row ? (row.id != null ? row.id : row.uid) : null, data: () => (row ? fromDb(tbl, row) : null) };
  }

  // ———— 写 ————
  async function docSet(sg, obj) {
    const { tbl, keys } = resolve(sg);
    const body = toDb(tbl, Object.assign({}, keys, obj));
    // 补齐缺的列，让 .set() 真的是「整份替换」（见上面 REPLACE 的说明）
    const rep = REPLACE[tbl];
    if (rep) for (const k in rep) if (!(k in body)) body[k] = rep[k];
    // 通知表是「只插不改」的：收件人不是写入者。PostgREST 只要带上
    // on_conflict 就会走 ON CONFLICT DO UPDATE 那条路，于是撞上收件人的
    // UPDATE 策略被拒（实测 403）。所以这里纯插入；同一条重复写的 409
    // 让页面自己的 try/catch 吞掉，正好。
    if (tbl === 'wz_notifs') {
      await rest(tbl, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(body)
      });
    } else {
      await rest(tbl + '?on_conflict=' + PKEY[tbl].join(','), {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(body)
      });
    }
    ping();
  }
  async function docUpdate(sg, obj) {
    const { tbl, keys } = resolve(sg);
    await rest(tbl + '?' + keyQuery(keys).slice(1), {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(toDb(tbl, obj))
    });
    ping();
  }
  async function docDel(sg) {
    const { tbl, keys } = resolve(sg);
    await rest(tbl + '?' + keyQuery(keys).slice(1), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    ping();
  }

  // 变化通知：定时问 + 写完立刻问
  // 文章列表里最占流量的是预览图（imgs 是内联的 base64 小图，一篇最多三张）。
  // 几百篇时每 20 秒整份拉一遍太费了，所以先只问「id/时间戳」这几个小字段，
  // 真的变了才去拉全部内容。每 5 轮强制整拉一次兜底，避免有改动漏掉。
  const LIGHT = { wz_articles: 'id,ts,edited' };
  const listeners = new Set();
  function ping() { listeners.forEach(f => { try { f(); } catch (e) {} }); }

  function watch(sg, st, cb, err) {
    let stop = false, busy = false, last = '', lastLight = '', first = true, tick = 0;
    let light = null;
    try { light = LIGHT[resolve(sg).tbl] || null; } catch (e) {}
    const run = async () => {
      if (stop || busy) return;
      if (!first && document.hidden) return;
      busy = true;
      try {
        if (light && tick % 5 !== 0) {
          const rows = await collGet(sg, st, light);
          const lsig = JSON.stringify(rows.map(r => r.data()));
          tick++;
          if (lsig === lastLight) return;   // 没变，省掉整拉
          lastLight = lsig;
        } else {
          tick++;
        }
        const docs = await collGet(sg, st);
        const sig = JSON.stringify(docs.map(d => d.data()));
        // 页面按 Firestore 的 QuerySnapshot 取，必须包一层 { docs }
        if (sig !== last) { last = sig; cb({ docs }); }
      } catch (e) { if (err) err(e); }
      finally { busy = false; first = false; }
    };
    run();
    const t = setInterval(run, POLL);
    listeners.add(run);
    return () => { stop = true; clearInterval(t); listeners.delete(run); };
  }

  // ———— 三种接口 ————
  function makeColl(sg) {
    const st = { filters: [], order: null, limit: 0 };
    const c = {
      orderBy(f, d) { st.order = [f, d || 'asc']; return c; },
      limit(n) { st.limit = n; return c; },
      where(f, op, v) { st.filters.push([f, op, v]); return c; },
      async get() { return { docs: await collGet(sg, st) }; },
      onSnapshot(cb, err) { return watch(sg, st, cb, err); }
    };
    return c;
  }
  function makeDoc(sg) {
    return {
      async get() { return docGet(sg); },
      async set(o) { return docSet(sg, o); },
      async update(o) { return docUpdate(sg, o); },
      async delete() { return docDel(sg); },
      collection(sub) { return makeColl(sg.concat(SPLIT(sub))); }
    };
  }
  const db = {
    collection(p) { return makeColl(SPLIT(p)); },
    doc(p) { return makeDoc(SPLIT(p)); }
  };

  function uidFrom(token) {
    try {
      const mid = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(mid)).sub || null;
    } catch (e) { return null; }
  }
  async function mustLogin() {
    const s = await Park.session();
    if (!s || !s.access_token) { location.replace('login.html'); throw new Error('need-login'); }
    const uid = uidFrom(s.access_token);
    if (!uid) { location.replace('login.html'); throw new Error('need-login'); }
    return uid;
  }

  const user = {
    async id() { return mustLogin(); },
    async me() {
      const uid = await mustLogin();
      try {
        const r = await Park.api('profiles?select=nickname&id=eq.' + encodeURIComponent(uid));
        const a = await r.json();
        const n = a && a[0] && a[0].nickname;
        if (n) return { name: n };
      } catch (e) {}
      return { name: '我' };
    },
    async can() { return true; },
    async canEdit() { return false; },   // 管理别人的内容：RLS 也不放行，先不做
    async isOwner() { return false; },
    async profiles(ids) {
      const out = {}, list = (ids || []).filter(Boolean);
      if (!list.length) return out;
      const r = await Park.api('profiles?select=id,nickname&id=in.(' + list.map(encodeURIComponent).join(',') + ')');
      const a = await r.json();
      (a || []).forEach(p => { out[p.id] = { name: p.nickname || '匿名' }; });
      return out;
    }
  };

  const assets = {
    async upload(blob) {
      const s = await Park.session();
      if (!s) throw new Error('need-login');
      const uid = uidFrom(s.access_token) || 'x';
      const ext = /png/.test(blob.type) ? 'png' : (/webp/.test(blob.type) ? 'webp' : 'jpg');
      const name = uid + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const r = await fetch(SB_URL + '/storage/v1/object/wz-img/' + name, {
        method: 'POST',
        headers: {
          apikey: SB_ANON,
          Authorization: 'Bearer ' + s.access_token,
          'Content-Type': blob.type || 'image/jpeg'
        },
        body: blob
      });
      if (!r.ok) throw new Error('图片没传上去（' + r.status + '）');
      return { url: SB_URL + '/storage/v1/object/public/wz-img/' + name };
    }
  };

  window.claude = {
    async use(what) {
      if (what === 'db') return db;
      if (what === 'user') return user;
      if (what === 'assets') return assets;
      return null;
    }
  };
})();
