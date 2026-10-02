// 全站公用的小工具
(function () {
  // 温柔的提示气泡
  window.toast = function (text) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2200);
  };

  // 站内跳转时轻轻淡出
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-soft]');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    document.body.classList.add('leaving');
    setTimeout(() => { location.href = a.href; }, 300);
  });

  // 从“返回”回到页面时，去掉淡出状态
  window.addEventListener('pageshow', () => document.body.classList.remove('leaving'));
})();
