// 游乐园配乐：左上角音乐按钮 + 播放器 + 设置面板
(function () {
  // ===== 曲目清单 =====
  // 等铃儿提供音乐文件后：title 换成真歌名，file 指向 assets/music/ 下的文件即可
  const TRACKS = [
    { id: 'aerie', title: 'Aerie - Lena Raine & Minecraft', file: 'assets/music/aerie.mp3' },
  ];

  const LS_KEY = 'park.music';
  const LIVE_KEY = 'park.music.live';   // 跨页续播：记住正在播哪首、进度、是否在播

  const state = {
    volume: 0.7,
    mode: 'list',       // single | list | random
    heartOnly: false,
    marks: {},          // { id: { heart:bool, fav:bool } }
  };

  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY));
      if (s && typeof s === 'object') {
        if (typeof s.volume === 'number') state.volume = s.volume;
        if (s.mode) state.mode = s.mode;
        if (typeof s.heartOnly === 'boolean') state.heartOnly = s.heartOnly;
        if (s.marks && typeof s.marks === 'object') state.marks = s.marks;
      }
    } catch {}
  }
  function saveState() {
    localStorage.setItem(LS_KEY, JSON.stringify({
      volume: state.volume, mode: state.mode, heartOnly: state.heartOnly, marks: state.marks,
    }));
  }

  const audio = new Audio();
  let currentId = null;
  let playing = false;

  function saveLive() {
    try {
      localStorage.setItem(LIVE_KEY, JSON.stringify({ id: currentId, time: audio.currentTime || 0, playing }));
    } catch {}
  }
  function clearLive() { try { localStorage.removeItem(LIVE_KEY); } catch {} }

  function mark(id) { return state.marks[id] || (state.marks[id] = { heart: false, fav: false }); }
  function list() { return TRACKS.filter(t => !state.heartOnly || mark(t.id).heart); }
  function track(id) { return TRACKS.find(t => t.id === id); }

  function setPlaying(v) {
    playing = v;
    saveLive();
    const wrap = document.getElementById('musicBtn');
    if (wrap) wrap.classList.toggle('playing', v);
    const p2 = document.getElementById('musicPlay2');
    if (p2) p2.textContent = v ? '⏸' : '▶';
  }

  function play(id) {
    const t = track(id);
    if (!t) return;
    currentId = id;
    audio.src = t.file;
    audio.volume = state.volume;
    audio.play().then(() => {
      setPlaying(true);
      renderNow();
      renderList();
    }).catch(() => {
      toast('这首歌的文件还没放进来哦');
      setPlaying(false);
    });
  }

  function pause() {
    audio.pause();
    setPlaying(false);
  }

  function toggle() {
    if (playing) { pause(); return; }
    if (!currentId) {
      const l = list();
      if (!l.length) { toast('还没有可播放的歌'); openPanel(); return; }
      play(l[0].id);
    } else {
      audio.play().then(() => setPlaying(true)).catch(() => toast('还没准备好，再点一下试试'));
    }
  }

  function next(auto) {
    const l = list();
    if (!l.length) { toast('没有可播放的歌'); return; }
    if (state.mode === 'single') {
      if (auto) { audio.currentTime = 0; audio.play().catch(() => {}); }
      else play(currentId || l[0].id);
      return;
    }
    if (state.mode === 'random') { play(l[Math.floor(Math.random() * l.length)].id); return; }
    // list 循环
    let i = l.findIndex(t => t.id === currentId);
    play(l[(i + 1 + l.length) % l.length].id);
  }
  function prev() {
    const l = list();
    if (!l.length) return;
    if (state.mode === 'random') { next(false); return; }
    let i = l.findIndex(t => t.id === currentId);
    play(l[(i - 1 + l.length) % l.length].id);
  }

  audio.addEventListener('ended', () => next(true));
  // 每秒把播放进度写进 live，换页后从这接着播
  let lastSave = 0;
  audio.addEventListener('timeupdate', () => {
    const now = Date.now();
    if (now - lastSave > 1000) { lastSave = now; saveLive(); }
  });

  // ===== 渲染 =====
  function renderNow() {
    const el = document.getElementById('musicNowTitle');
    const t = currentId && track(currentId);
    if (el) el.textContent = t ? t.title : '还没有播放';
  }
  function renderMode() {
    document.querySelectorAll('#musicMode button').forEach(b =>
      b.classList.toggle('on', b.dataset.mode === state.mode));
  }
  function renderList() {
    const box = document.getElementById('musicList');
    if (!box) return;
    box.innerHTML = '';
    TRACKS.forEach(t => {
      const m = mark(t.id);
      const row = document.createElement('div');
      row.className = 'music-item' + (t.id === currentId ? ' cur' : '');
      const title = document.createElement('span');
      title.className = 'music-item__title';
      title.textContent = t.title;
      title.onclick = () => play(t.id);
      const heart = document.createElement('button');
      heart.className = 'music-item__icon' + (m.heart ? ' on' : '');
      heart.textContent = m.heart ? '♥' : '♡';
      heart.title = '标心（标了后「只播标心」时才会播它）';
      heart.onclick = () => { m.heart = !m.heart; saveState(); renderList(); };
      const fav = document.createElement('button');
      fav.className = 'music-item__icon' + (m.fav ? ' on' : '');
      fav.textContent = m.fav ? '★' : '☆';
      fav.title = '收藏';
      fav.onclick = () => { m.fav = !m.fav; saveState(); renderList(); };
      row.append(title, heart, fav);
      box.appendChild(row);
    });
  }
  function renderAll() {
    renderNow(); renderMode(); renderList();
    const v = document.getElementById('musicVol');
    if (v) v.value = state.volume;
    const h = document.getElementById('musicHeartOnly');
    if (h) h.checked = state.heartOnly;
  }

  // ===== 面板 =====
  function openPanel() { const p = document.getElementById('musicPanel'); if (p) p.classList.add('on'); }
  function closePanel() { const p = document.getElementById('musicPanel'); if (p) p.classList.remove('on'); }

  // ===== 注入 DOM =====
  function inject() {
    // 个人页已自带「音乐设置」入口，不再显示右上角按钮（body 打 data-music="none"）
    const showBtn = document.body.dataset.music !== 'none';

    const btn = showBtn ? document.createElement('div') : null;
    if (btn) {
      btn.className = 'music-btn';
      btn.id = 'musicBtn';
      btn.innerHTML =
        '<button class="music-btn__play" id="musicPlay" aria-label="播放/暂停">🎵</button>' +
        '<button class="music-btn__gear" id="musicGear" aria-label="音乐设置">⚙</button>';
    }

    const panel = document.createElement('div');
    panel.className = 'music-panel';
    panel.id = 'musicPanel';
    panel.innerHTML =
      '<div class="music-panel__sheet">' +
        '<div class="music-panel__head"><span>音乐</span><button id="musicClose" aria-label="关闭">×</button></div>' +
        '<div class="music-now">' +
          '<div class="music-now__title" id="musicNowTitle">还没有播放</div>' +
          '<div class="music-now__ctrl">' +
            '<button id="musicPrev" aria-label="上一首">⏮</button>' +
            '<button id="musicPlay2" aria-label="播放/暂停">▶</button>' +
            '<button id="musicNext" aria-label="下一首">⏭</button>' +
          '</div>' +
        '</div>' +
        '<div class="music-mode" id="musicMode">' +
          '<button data-mode="single">单曲循环</button>' +
          '<button data-mode="list">列表循环</button>' +
          '<button data-mode="random">随机</button>' +
        '</div>' +
        '<div class="music-vol"><span>音量</span><input type="range" id="musicVol" min="0" max="1" step="0.05"></div>' +
        '<label class="music-heartonly"><input type="checkbox" id="musicHeartOnly"> 只播放标心的歌</label>' +
        '<div class="music-list" id="musicList"></div>' +
      '</div>';

    if (btn) document.body.appendChild(btn);
    document.body.appendChild(panel);

    if (btn) {
      document.getElementById('musicPlay').onclick = toggle;
      document.getElementById('musicGear').onclick = openPanel;
    }
    document.getElementById('musicClose').onclick = closePanel;
    document.getElementById('musicPlay2').onclick = toggle;
    document.getElementById('musicPrev').onclick = prev;
    document.getElementById('musicNext').onclick = () => next(false);
    document.getElementById('musicVol').oninput = (e) => { state.volume = parseFloat(e.target.value); audio.volume = state.volume; saveState(); };
    document.getElementById('musicHeartOnly').onchange = (e) => { state.heartOnly = e.target.checked; saveState(); };
    document.querySelectorAll('#musicMode button').forEach(b => b.onclick = () => { state.mode = b.dataset.mode; saveState(); renderMode(); });
    panel.addEventListener('click', (e) => { if (e.target === panel) closePanel(); });

    renderAll();
    restore();
  }

  // 跨页续播：上次正在播放的话，页面加载后自动接着同一首、同一进度继续
  function restore() {
    try {
      const l = JSON.parse(localStorage.getItem(LIVE_KEY));
      if (!l || !l.playing || !l.id || !track(l.id)) return;
      currentId = l.id;
      const t = track(l.id);
      audio.src = t.file;
      audio.volume = state.volume;
      const seek = typeof l.time === 'number' ? l.time : 0;
      const start = () => {
        try { audio.currentTime = seek; } catch {}
        audio.play().then(() => { setPlaying(true); renderNow(); renderList(); }).catch(() => {});
      };
      if (audio.readyState >= 1) start();
      else audio.addEventListener('loadedmetadata', start, { once: true });
    } catch {}
  }

  function init() {
    loadState();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
    else inject();
  }

  window.Music = { open: openPanel, toggle, play, pause };
  init();
})();
