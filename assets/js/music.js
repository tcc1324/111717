// 游乐园配乐：右上角音乐按钮 + 播放器 + 设置面板
(function () {
  // ===== 曲目清单 =====
  const TRACKS = [
    { id: "aerie", title: "Aerie - Lena Raine & Minecraft", file: "assets/music/aerie.mp3" },
    { id: "incomparable-beauty-sodagreen", title: "无与伦比的美丽 - 苏打绿", file: "assets/music/incomparable-beauty-sodagreen.mp3" },
    { id: "rainy-night-sodagreen", title: "下雨的夜晚 - 苏打绿", file: "assets/music/rainy-night-sodagreen.mp3" },
    { id: "believe-sodagreen", title: "相信 - 苏打绿", file: "assets/music/believe-sodagreen.mp3" },
    { id: "kanade-music-box", title: "奏(かなで) (スキマスイッチ) - Vega☆オルゴール", file: "assets/music/kanade-music-box.mp3" },
    { id: "angel-libera", title: "Angel - Libera", file: "assets/music/angel-libera.mp3" },
    { id: "concertino-bianco", title: "Concertino bianco for Piano in C major_I Con intenerimento - Alexei Lubimov", file: "assets/music/concertino-bianco.mp3" },
    { id: "dauw", title: "Dauw - Nils Frahm", file: "assets/music/dauw.mp3" },
    { id: "firebugs", title: "Firebugs - Lena Raine、Minecraft", file: "assets/music/firebugs.mp3" },
    { id: "hidden-sanctuary", title: "Hidden Sanctuary - Poemme", file: "assets/music/hidden-sanctuary.mp3" },
    { id: "last-days-yoshida", title: "Last Days - 吉田靖", file: "assets/music/last-days-yoshida.mp3" },
    { id: "memo-flora-yoshimatsu", title: "Piano Concerto 'Memo Flora', Op.67_ II. Petals_ Andante - 吉松隆", file: "assets/music/memo-flora-yoshimatsu.mp3" },
    { id: "spiegel-im-spiegel", title: "Spiegel im Spiegel - Arvo Pärt", file: "assets/music/spiegel-im-spiegel.mp3" },
    { id: "still-life-sakamoto", title: "still life - 坂本龍一", file: "assets/music/still-life-sakamoto.mp3" },
    { id: "subwoofer-lullaby", title: "Subwoofer Lullaby - C418", file: "assets/music/subwoofer-lullaby.mp3" },
    { id: "suite-for-toy-piano", title: "Suite For Toy Piano (1948) - John Cage", file: "assets/music/suite-for-toy-piano.mp3" },
    { id: "to-sun", title: "To Sun - 可可說", file: "assets/music/to-sun.mp3" },
    { id: "white-landscapes-2", title: "White Landscapes Op. 47a_ 2. Stillness In Snow_ Moderato - 吉松隆", file: "assets/music/white-landscapes-2.mp3" },
    { id: "white-landscapes-3", title: "White Landscapes Op. 47a_ 3. Disappearance Of Snow_ Largo - 吉松隆", file: "assets/music/white-landscapes-3.mp3" },
    { id: "kinema-betsuno", title: "キネマ - 別野加奈", file: "assets/music/kinema-betsuno.mp3" },
    { id: "why-does-life-betsuno", title: "どうして生命は、こんな美しい夜にも涙を流すのだろう - 別野加奈", file: "assets/music/why-does-life-betsuno.mp3" },
    { id: "piano-folio-yoshimatsu", title: "ピアノ・フォリオ…消えたプレイアードに寄せて - 吉松隆", file: "assets/music/piano-folio-yoshimatsu.mp3" },
    { id: "dots-neil-jones", title: "点点点（・・・） - Neil Jones", file: "assets/music/dots-neil-jones.mp3" },
    { id: "tapiola-vision-yoshimatsu", title: "塔皮奥拉幻象（タピオラ幻景）-吉松隆", file: "assets/music/tapiola-vision-yoshimatsu.mp3" },
    { id: "birthday-romance-yoshimatsu", title: "2つのロマンス　诞生日のロマンス - 吉松隆", file: "assets/music/birthday-romance-yoshimatsu.mp3" },
  ];

  const LS_KEY = 'park.music';
  const LIVE_KEY = 'park.music.live';
  const OWNER_KEY = 'park.music.owner';
  const HANDOFF_MS = 8000;

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
  let loading = false;   // 点了播放但音频还没真正出声（在缓冲）
  let playToken = 0;   // 防切歌竞态：每次切歌播放递增，过期回调直接忽略

  const say = (m) => { try { if (typeof toast === 'function') toast(m); } catch {} };
  const PAGE_ID = Math.random().toString(36).slice(2);
  let iAmOwner = false;   // 本页是不是当前"出声者"
  let leaving = false;    // 页面正在离开

  function claim() {
    iAmOwner = true;
    try { localStorage.setItem(OWNER_KEY, PAGE_ID + ':' + Date.now()); } catch {}
  }
  function saveLive() {
    if (!iAmOwner) return;   // 被缓存或已让位的旧页，不许覆写存档
    try {
      localStorage.setItem(LIVE_KEY, JSON.stringify({
        id: currentId, time: audio.currentTime || 0, playing, ts: Date.now(),
      }));
    } catch {}
  }

  // 调试日志：地址栏加 ?musicdebug=1 打开，?musicdebug=0 关闭
  let DEBUG = false, dbgBox = null, dbgLines = [];
  function dbg(msg) {
    if (!DEBUG) return;
    const line = new Date().toISOString().slice(14, 22) + ' [' + PAGE_ID.slice(0, 3) + '] ' + msg;
    try {
      dbgLines = JSON.parse(localStorage.getItem('park.music.log')) || [];
      dbgLines.push(line);
      dbgLines = dbgLines.slice(-60);
      localStorage.setItem('park.music.log', JSON.stringify(dbgLines));
    } catch { dbgLines.push(line); }
    if (!document.body) return;
    if (!dbgBox) {
      dbgBox = document.createElement('pre');
      dbgBox.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:38vh;overflow:auto;margin:0;padding:6px;font:10px/1.4 monospace;background:rgba(0,0,0,.78);color:#9f9;z-index:9999;pointer-events:none;white-space:pre-wrap';
      document.body.appendChild(dbgBox);
    }
    dbgBox.textContent = dbgLines.join('\n');
    dbgBox.scrollTop = dbgBox.scrollHeight;
  }

  function mark(id) { return state.marks[id] || (state.marks[id] = { heart: false, fav: false }); }
  function list() { return TRACKS.filter(t => !state.heartOnly || mark(t.id).heart); }
  function track(id) { return TRACKS.find(t => t.id === id); }

  // 状态变更订阅：供「音乐小屋」等页面实时同步播放状态/曲名
  const listeners = [];
  function emit() {
    const snap = { playing, loading, currentId, title: currentId && track(currentId) ? track(currentId).title : null };
    listeners.forEach(f => { try { f(snap); } catch {} });
  }
  function setPlaying(v, skipSave) {
    playing = v;
    if (v && !skipSave) claim();
    if (!skipSave) saveLive();
    const wrap = document.getElementById('musicBtn');
    if (wrap) wrap.classList.toggle('playing', v);
    const p2 = document.getElementById('musicPlay2');
    if (p2) p2.classList.toggle('playing', v);
    emit();
  }

  // 加载态：点了播放但音频还没出声。按钮呼吸 + 曲名挂「（加载中…）」，出声后撤掉
  function setLoading(v) {
    loading = v;
    const wrap = document.getElementById('musicBtn');
    if (wrap) wrap.classList.toggle('loading', v);
    const p2 = document.getElementById('musicPlay2');
    if (p2) p2.classList.toggle('loading', v);
    renderNow();   // 曲名后缀跟着 loading 变
    emit();
  }

  function play(id) {
    const t = track(id);
    if (!t) return;
    currentId = id;
    const token = ++playToken;
    audio.src = t.file;
    audio.volume = state.volume;
    // 乐观亮灯：按钮点了立刻变，不等音乐；加载期间挂「加载中…」直到出声
    setPlaying(true);
    setLoading(true);
    renderList();
    audio.play().then(() => {
      if (token !== playToken) return;   // 已切歌，忽略过期回调（新歌自己管状态）
      setLoading(false);   // 兜底；'playing' 事件也会收尾
    }).catch((err) => {
      if (token !== playToken) return;   // 已切歌，忽略过期回调
      if (err && err.name === 'AbortError') return;  // 用户自己按了暂停/被打断，pause 已处理
      setLoading(false);
      if (err && err.name === 'NotSupportedError') {
        // 文件真的没有/坏掉：才真正灭掉火种，避免每次进站都空重试
        setPlaying(false);
        toast('这首歌的文件还没放进来哦');
      } else {
        // 自动播放被拦、网络抖动、切页被打断等临时情况：保火种，别覆写 live 存档
        setPlaying(false, true);
        if (err && err.name === 'NotAllowedError') toast('点一下页面，歌就继续～');
        else toast('还没准备好，再点一下试试');
      }
    });
  }

  function pause() {
    playToken++;   // 让还在等待的播放/续播回调作废，避免暂停后又被拉起来
    audio.pause();
    setLoading(false);
    setPlaying(false);
  }

  function toggle() {
    if (playing) { pause(); return; }
    if (!currentId) {
      const l = list();
      if (!l.length) { toast('还没有可播放的歌'); openPanel(); return; }
      play(l[0].id);
    } else {
      const token = playToken;   // 续播不切歌、不递增；之后若切歌，此回调作废
      setPlaying(true);   // 乐观亮灯
      setLoading(true);
      audio.play().then(() => {
        if (token !== playToken) return;
        setLoading(false);
      }).catch((err) => {
        if (token !== playToken) return;
        if (err && err.name === 'AbortError') return;
        setLoading(false);
        setPlaying(false, true);   // 临时失败：保火种，别把跨页续播的存档抹掉
        toast('还没准备好，再点一下试试');
      });
    }
  }

  function next(auto) {
    const l = list();
    if (!l.length) { toast('没有可播放的歌'); return; }
    if (state.mode === 'single' && auto) {
      audio.currentTime = 0;
      const token = playToken;
      setLoading(true);   // 重新缓冲，挂加载态直到出声
      audio.play().then(() => {
        if (token !== playToken) return;
        setLoading(false);
      }).catch((err) => {
        if (token !== playToken) return;
        if (err && err.name === 'AbortError') return;
        setLoading(false);
        setPlaying(false, true);   // 单曲循环重新缓冲失败：临时，保火种
      });
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
  // 加载态兜底：真正出声时撤「加载中」；播放中网络卡住（重新缓冲）时再挂上
  audio.addEventListener('playing', () => { if (loading) setLoading(false); });
  audio.addEventListener('waiting', () => { if (playing && !audio.paused) setLoading(true); });
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
    if (el) el.textContent = t ? (loading ? t.title + '（加载中…）' : t.title) : '还没有播放';
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
        '<div class="music-hush">静静聆听</div>' +
        '<div class="music-note">提示：换页时音乐会尽量接着放；个别浏览器或网络不稳时可能短暂暂停，点一下页面即可继续。也可以到「音乐小屋」安心聆听。</div>' +
        '<a class="music-house-link" href="music-house.html">🏡 进入音乐小屋</a>' +
        '<div class="music-now">' +
          '<div class="music-now__title" id="musicNowTitle">还没有播放</div>' +
          '<div class="music-now__ctrl">' +
            '<button id="musicPrev" aria-label="上一首"><svg viewBox="0 0 24 24"><path d="M6 5v14M18 5l-9 7 9 7z" fill="currentColor"/></svg></button>' +
            '<button id="musicPlay2" aria-label="播放/暂停"><svg class="ic-play" viewBox="0 0 24 24"><path d="M8 5l12 7-12 7z" fill="currentColor"/></svg><svg class="ic-pause" viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg></button>' +
            '<button id="musicNext" aria-label="下一首"><svg viewBox="0 0 24 24"><path d="M6 5l9 7-9 7zM18 5v14" fill="currentColor"/></svg></button>' +
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
    syncUI();
  }

  function syncUI() {
    ['musicBtn', 'musicPlay2'].forEach(id => {
      const e = document.getElementById(id);
      if (!e) return;
      e.classList.toggle('playing', playing);
      e.classList.toggle('loading', loading);
    });
    renderNow();
  }

  // ===== 界面与真实音频保持同步 =====
  audio.addEventListener('pause', () => {
    // 系统打断（拔耳机、来电、锁屏键）时界面跟着变；自己主动暂停、播完、换页不算
    if (leaving || audio.ended || !playing || loading) return;
    dbg('system pause');
    setPlaying(false, true);
  });
  audio.addEventListener('play', () => {
    if (leaving || playing) return;
    dbg('system play');
    setPlaying(true);   // 系统恢复播放时界面跟着亮，并接管出声权
  });
  audio.addEventListener('error', () => {
    const e = audio.error;
    if (!currentId || !e || e.code === 4) return;   // 4=文件不存在，play() 的 catch 里已处理
    dbg('audio error code=' + e.code);
    setLoading(false);
    setPlaying(false, true);
    say('网络不太稳，这首没加载出来，点一下再试试');
  });
  ['play','playing','pause','waiting','stalled','error','loadedmetadata','canplay','ended','emptied','abort']
    .forEach(n => audio.addEventListener(n, () =>
      dbg('audio:' + n + ' rs=' + audio.readyState + ' t=' + (audio.currentTime || 0).toFixed(1))));

  // ===== 页面生命周期 =====
  window.addEventListener('pagehide', () => {
    dbg('pagehide');
    leaving = true;
    saveLive();   // 此刻仍是 playing:true，下一页据此续播
    // 把音频和网络连接一起交还，免得被缓存的旧页继续出声、或占着同一个 mp3
    try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch {}
  });
  window.addEventListener('pageshow', (e) => {
    dbg('pageshow persisted=' + e.persisted);
    leaving = false;
    if (e.persisted) restore();   // 从前进后退缓存回来：按存档重新接上
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveLive();
  });
  // 别的页面接手出声时，这一页安静让位
  window.addEventListener('storage', (e) => {
    if (e.key !== OWNER_KEY || !e.newValue) return;
    if (e.newValue.split(':')[0] === PAGE_ID) return;
    dbg('yield to other page');
    iAmOwner = false;
    if (playing || loading) {
      playToken++;
      audio.pause();
      setLoading(false);
      setPlaying(false, true);
    }
  });

  // ===== 续播 =====
  function restore() {
    let l = null;
    try { l = JSON.parse(localStorage.getItem(LIVE_KEY)); } catch {}
    if (!l || !l.id || !track(l.id)) return;
    const seek = typeof l.time === 'number' ? l.time : 0;
    const age = Date.now() - (l.ts || 0);
    const wantPlay = !!l.playing && age < HANDOFF_MS;
    const token = ++playToken;
    dbg('restore id=' + l.id + ' t=' + seek.toFixed(1) + ' wantPlay=' + wantPlay + ' age=' + age);

    currentId = l.id;
    audio.preload = wantPlay ? 'auto' : 'metadata';
    audio.src = track(l.id).file;
    audio.volume = state.volume;
    renderList();
    if (wantPlay) { setPlaying(true, true); setLoading(true); claim(); }
    else { setPlaying(false, true); setLoading(false); }

    let started = false;
    const begin = () => {
      if (token !== playToken) { audio.removeEventListener('loadedmetadata', begin); return; }
      if (started) return;
      started = true;
      audio.removeEventListener('loadedmetadata', begin);
      if (seek > 0) {
        try { audio.currentTime = isFinite(audio.duration) ? Math.min(seek, Math.max(0, audio.duration - 1)) : seek; } catch {}
      }
      if (!wantPlay) return;
      audio.play().then(() => {
        if (token !== playToken) return;
        setLoading(false);
        setPlaying(true);
      }).catch((err) => {
        if (token !== playToken || (err && err.name === 'AbortError')) return;
        setLoading(false);
        setPlaying(false, true);   // 界面回退，存档仍是 playing:true，再跳页还能续
        if (err && err.name === 'NotAllowedError') {
          say('点一下页面，歌就继续～');
          const resume = () => {
            document.removeEventListener('click', resume);
            document.removeEventListener('touchstart', resume);
            if (token !== playToken) return;
            setLoading(true);
            claim();
            audio.play().then(() => {
              if (token !== playToken) return;
              setLoading(false);
              setPlaying(true);
            }).catch(() => { setLoading(false); });
          };
          document.addEventListener('click', resume);
          document.addEventListener('touchstart', resume);
        } else {
          say('这首歌没能接上，点一下播放键试试');
        }
      });
    };
    audio.addEventListener('loadedmetadata', begin);
    if (wantPlay) setTimeout(begin, 1500);   // iPhone 上 loadedmetadata 偶发不来，超时兜底
  }

  function init() {
    loadState();
    try {
      const m = location.search.match(/musicdebug=(\d)/);
      if (m) {
        localStorage.setItem('park.music.debug', m[1]);
        if (m[1] !== '1') localStorage.removeItem('park.music.log');
      }
      DEBUG = localStorage.getItem('park.music.debug') === '1';
    } catch {}
    restore();   // 不等 DOM 和后面的大脚本，音频先接上
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
    else inject();
  }

  window.Music = {
    open: openPanel, toggle, play, pause,
    isPlaying: () => playing,
    now: () => currentId && track(currentId) ? track(currentId).title : null,
    onChange: (fn) => {
      listeners.push(fn);
      fn({ playing, currentId, title: currentId && track(currentId) ? track(currentId).title : null });
    },
  };
  init();
})();
