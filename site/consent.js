// SPDX-License-Identifier: MIT
// Opt-in cookie consent for this introduction page only. Google Analytics
// (gtag.js) is fetched from googletagmanager.com only after the visitor
// clicks "Accept" here; declining, or never choosing, loads nothing. The
// CSV editor app itself has no equivalent script and makes no network
// requests at runtime.
(function () {
  var GA_ID = 'G-0GXS4PWS1N';
  var STORAGE_KEY = 'rs-consent';
  var banner = document.getElementById('cookie-consent');
  var settingsLink = document.getElementById('cookie-settings-link');
  if (!banner) return;

  function getChoice() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function setChoice(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {
      /* private browsing or storage disabled: consent still applies for this pageview */
    }
  }

  function loadGtag() {
    if (window.__rsGtagLoaded) return;
    window.__rsGtagLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(script);
  }

  function showBanner() {
    banner.hidden = false;
  }

  function hideBanner() {
    banner.hidden = true;
  }

  banner.querySelectorAll('[data-consent-action]').forEach(function (button) {
    button.addEventListener('click', function () {
      var accepted = button.getAttribute('data-consent-action') === 'accept';
      setChoice(accepted ? 'granted' : 'denied');
      hideBanner();
      if (accepted) loadGtag();
    });
  });

  if (settingsLink) {
    settingsLink.addEventListener('click', function (event) {
      event.preventDefault();
      showBanner();
    });
  }

  var choice = getChoice();
  if (choice === 'granted') {
    loadGtag();
  } else if (choice !== 'denied') {
    showBanner();
  }
})();
