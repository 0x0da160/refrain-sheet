// SPDX-License-Identifier: MIT
// Hero demo: steps through the four scenes of the drawn app screen
// (site/partials/hero.html). Copy is pre-rendered per language at build
// time, so the page is fully readable without JavaScript — the demo then
// rests on its last scene, which is also where it stays for visitors who
// prefer reduced motion. The pause button satisfies WCAG 2.2.2.
//
//   .is-playing  the visitor wants it to play (drives the button label)
//   .is-running  it is actually advancing now (paused while off screen or
//                in a hidden tab, to save work)
(function () {
  var demo = document.querySelector('[data-demo]');
  if (!demo) return;
  var toggle = demo.querySelector('[data-demo-toggle]');
  // How long each scene stays on screen, in ms (index = scene number).
  var DURATION = [0, 2600, 3200, 3600, 4400];
  var scene = 4;
  var timer = null;
  var wanted = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var visible = true;

  function tick() {
    scene = (scene % 4) + 1;
    demo.setAttribute('data-scene', String(scene));
    timer = window.setTimeout(tick, DURATION[scene]);
  }

  function update() {
    var run = wanted && visible && !document.hidden;
    var running = demo.classList.contains('is-running');
    if (run && !running) {
      demo.classList.add('is-running');
      tick();
    } else if (!run && running) {
      demo.classList.remove('is-running');
      window.clearTimeout(timer);
    }
    demo.classList.toggle('is-playing', wanted);
  }

  toggle.hidden = false;
  toggle.addEventListener('click', function () {
    wanted = !wanted;
    update();
  });
  document.addEventListener('visibilitychange', update);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      update();
    }).observe(demo);
  }
  update();
})();
