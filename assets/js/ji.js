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
    return `<div class="stamp ${extra || ''}" data-id="${s.id}"><div class="face"><div class="in" ${pic}>${s.img ? '' : '✉'}</div></div>
      <div class="cap">${esc(s.words)}<br>${hrs(s.hours)}</div></div>`;
  }
  const when = t => {
    const d = new Date(t), p = n => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  window.Ji = { rpc, esc, hrs, stamp, when };
})();
