// SPDX-License-Identifier: MIT
// Header theme switch, then the page demos.
//
// Theme: System (no data-theme on <html>, so the design tokens follow the
// OS setting), Light or Dark (data-theme on <html>). A Light or Dark choice
// is remembered in localStorage and applied before first paint by
// partials/theme-init.html; System forgets it. The switch stays hidden
// without JavaScript, where the page simply follows the OS.
(function () {
  var KEY = 'rs-theme';
  var root = document.documentElement;
  // The header has the switch; the footer repeats it for narrow screens,
  // where the header has no room for it.
  var groups = document.querySelectorAll('[data-theme-switch]');
  var buttons = document.querySelectorAll('[data-theme-switch] [data-theme-choice]');
  if (!groups.length) return;

  function current() {
    var theme = root.getAttribute('data-theme');
    return theme === 'light' || theme === 'dark' ? theme : 'system';
  }

  function show() {
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute('data-theme-choice') === current();
      buttons[i].setAttribute('aria-pressed', String(on));
    }
  }

  function choose(event) {
    var button = event.target.closest('[data-theme-choice]');
    if (!button) return;
    var choice = button.getAttribute('data-theme-choice');
    if (choice === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
    try {
      if (choice === 'system') window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, choice);
    } catch (e) {
      /* storage disabled: the choice lasts for this page view */
    }
    show();
  }

  for (var i = 0; i < groups.length; i++) {
    groups[i].addEventListener('click', choose);
    groups[i].hidden = false;
  }
  show();
})();

// Page demos: each [data-demo] figure steps through the scenes of its drawn
// app screen (the CSV demo in site/partials/hero.html, the spreadsheet demo
// in site/partials/features.html). Copy is pre-rendered per language at
// build time, so the page is fully readable without JavaScript — each demo
// then rests on its last scene, which is also where it stays for visitors
// who prefer reduced motion. The pause button satisfies WCAG 2.2.2.
//
//   data-scenes  how many scenes the demo has (it rests on the last one)
//   .is-playing  the visitor wants it to play (drives the button label)
//   .is-running  it is actually advancing now (paused while off screen or
//                in a hidden tab, to save work)
(function () {
  // How long each scene stays on screen, in ms (index = scene number - 1).
  var DURATION = [2600, 3200, 3600, 4400, 4400];
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setUp(demo) {
    var toggle = demo.querySelector('[data-demo-toggle]');
    var count = Number(demo.getAttribute('data-scenes')) || 4;
    var scene = count;
    var timer = null;
    var wanted = !reduced;
    var visible = true;

    function tick() {
      scene = (scene % count) + 1;
      demo.setAttribute('data-scene', String(scene));
      timer = window.setTimeout(tick, DURATION[scene - 1]);
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
  }

  var demos = document.querySelectorAll('[data-demo]');
  for (var i = 0; i < demos.length; i++) setUp(demos[i]);
})();
