// 寄：几个页面共用的小工具
(function () {
  Park.session().then(s => { if (!s) location.replace('login.html'); });
  async function rpc(name, args) {
    try {
      const r = await Park.api('rpc/' + name, { method: 'POST', body: JSON.stringify(args || {}) });
      if (!r.ok) return { err: '出了点小问题，稍后再试' };
      return { data: await r.json() };
    } catch { return { err: '网络不太好，稍后再试' }; }
  }
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&'+'quot;', "'": '&#39;' }[c]));
  const hrs = h => (+h % 1 ? (+h).toFixed(1) : +h) + ' 小时';
  // 一张邮票的样子
  function stamp(s, extra) {
    const pic = s.img ? `style="background-image:url('${esc(s.img)}')"` : '';
    const sid = s.sid ? `<div class="sid">${esc(s.sid)}</div>` : '';
    const series = s.series_title ? `<div class="series"><span class="sn">${esc(s.series_title)}</span>${s.series_theme ? `<span class="st">${esc(s.series_theme)}</span>` : ''}</div>` : '';
    return `<div class="stamp ${extra || ''}" data-id="${s.id}"><div class="face"><div class="in" ${pic}>${s.img ? '' : '✉'}</div></div>
      ${sid}${series}<div class="cap">${esc(s.words)}<br>${hrs(s.hours)}</div></div>`;
  }
  const when = t => {
    const d = new Date(t), p = n => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // ---- 邮票放大：公共弹层（邮局等页面共用，点一下看大图）----
  let zoomBox = null, zoomShown = null;
  function zoomInit() {
    if (zoomBox) return;
    const d = document.createElement('div');
    d.id = 'stampZoom';
    d.className = 'zoom';
    d.innerHTML = '<div class="zbg"></div><div class="zbox">'
      + '<div class="zstamp" id="stampZoomStamp"></div>'
      + '<img class="zimg" id="stampZoomImg" alt="邮票">'
      + '<div class="zinfo" id="stampZoomInfo"></div>'
      + '<div class="zact" id="stampZoomAct"></div>'
      + '</div>';
    document.body.appendChild(d);
    zoomBox = d;
    d.querySelector('.zbg').onclick = zoomClose;
    d.querySelector('.zimg').onclick = e => { e.stopPropagation(); zoomClose(); };
    d.querySelector('.zstamp').onclick = e => { e.stopPropagation(); if (zoomShown && zoomShown.img) d.classList.add('full'); };
  }
  function zoomClose() { if (zoomBox) { zoomBox.classList.remove('on'); zoomBox.classList.remove('full'); } }
  // s：邮票对象；action：可选 { label, onClick }，用于「领取」等按钮
  function zoom(s, action) {
    zoomInit();
    zoomShown = s;
    const d = zoomBox, g = id => document.getElementById(id);
    const pic = s.img ? `style="background-image:url('${esc(s.img)}')"` : '';
    g('stampZoomStamp').innerHTML = `<div class="in" ${pic}>${s.img ? '' : '✉'}</div>`;
    g('stampZoomImg').src = s.img || '';
    const bits = [];
    if (s.sid) bits.push(esc(s.sid));
    if (s.n) bits.push('收到 ×' + s.n);
    if (s.maker_nick) bits.push(esc(s.maker_nick));
    const at = s.last_at || s.created_at || s.got_at || s.used_at;
    if (at) bits.push(when(at));
    if (s.hours != null) bits.push(hrs(s.hours));
    const series = s.series_title ? `<div class="zseries"><b>${esc(s.series_title)}</b>${s.series_theme ? `<span>${esc(s.series_theme)}</span>` : ''}</div>` : '';
    const w = s.words ? esc(s.words) : '';
    g('stampZoomInfo').innerHTML = (w ? `<div class="w">${w}</div>` : '') + series + (bits.length ? `<div class="m">${bits.join(' · ')}</div>` : '');
    const act = g('stampZoomAct');
    if (action) {
      act.style.display = 'block';
      act.innerHTML = `<button class="btn" id="stampZoomBtn"${action.disabled ? ' disabled' : ''}>${esc(action.label)}</button>`;
      if (!action.disabled) g('stampZoomBtn').onclick = () => action.onClick();
    } else {
      act.style.display = 'none';
      act.innerHTML = '';
    }
    d.classList.remove('full');
    d.classList.add('on');
  }

  window.Ji = { rpc, esc, hrs, stamp, when, zoom, zoomClose };
})();
