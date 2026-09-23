// SPDX-License-Identifier: MIT
// Scroll reveal only. Copy is pre-rendered per language at build time,
// so the page is fully readable without JavaScript.
(function () {
  var els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    els.forEach(function (el) {
      el.classList.add('in');
    });
    return;
  }
  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
  );
  els.forEach(function (el) {
    io.observe(el);
  });
})();
