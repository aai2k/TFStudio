// web/demo-boot.js — boot diagnostics for the web demo (loaded FIRST, before any
// vendor/renderer script). On a phone there is no console, so a JS error during
// boot just yields a blank #root. This BUFFERS everything (errors, rejections,
// console.error/warn, resource failures) but only PAINTS a visible overlay when the
// app genuinely fails to mount (the watchdog) or a real exception fires — so noise
// (a slow vendor, a benign console.error) never covers an otherwise-working app.
//
// Pure, dependency-free, defensive — must never itself throw.
(function () {
  'use strict';
  var logs = [];
  var shown = false;
  function log(kind, msg) { try { logs.push('[' + kind + '] ' + msg); } catch (_) {} }

  function show() {
    try { var s = document.getElementById('tfs-demo-splash'); if (s) s.remove(); } catch (_) {}
    if (shown) { paint(); return; }
    shown = true;
    paint();
  }
  function paint() {
    try {
      var id = 'tfs-demo-error';
      var el = document.getElementById(id);
      if (!el) {
        if (!document.body) return;
        el = document.createElement('div');
        el.id = id;
        el.setAttribute('style', [
          'position:fixed', 'inset:0', 'z-index:2147483647', 'background:#fff',
          'color:#b00020', 'font:13px/1.45 monospace', 'padding:16px',
          'overflow:auto', '-webkit-overflow-scrolling:touch', 'white-space:pre-wrap',
          'word-break:break-word',
        ].join(';'));
        document.body.appendChild(el);
      }
      el.textContent =
        'TFStudio demo — boot error\n(screenshot this and send it)\n\n' +
        'UA: ' + navigator.userAgent + '\n\n' + logs.join('\n\n');
    } catch (_) { /* never throw from the reporter */ }
  }

  window.addEventListener('error', function (e) {
    if (e && e.message) {
      // A real JS exception — fatal, paint immediately.
      var where = (e.filename || '') + ':' + (e.lineno || '') + ':' + (e.colno || '');
      var stack = (e.error && e.error.stack) ? '\n' + e.error.stack : '';
      log('error', e.message + '\n' + where + stack);
      show();
    } else if (e && e.target && e.target.tagName) {
      // Resource load failure — BUFFER only. With deferred vendor scripts a failed
      // Plotly/katex no longer blocks the app, so this must not paint over a
      // working UI; if it actually broke boot, the watchdog will surface it.
      var tag = e.target.tagName.toUpperCase();
      log('resource', tag + ' failed to load: ' + (e.target.src || e.target.href || ''));
    }
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    log('promise', (r && (r.stack || r.message)) ? (r.stack || r.message) : String(r));
  });

  // React logs render errors via console.error without always throwing — buffer
  // them (don't paint; React also console.errors benign warnings).
  ['error', 'warn'].forEach(function (lvl) {
    var orig = console[lvl];
    console[lvl] = function () {
      try {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i];
          parts.push(a && a.stack ? a.stack : (typeof a === 'object' ? JSON.stringify(a) : String(a)));
        }
        log('console.' + lvl, parts.join(' '));
      } catch (_) {}
      try { return orig.apply(console, arguments); } catch (_) {}
    };
  });

  function env() {
    function t(x) { try { return typeof x; } catch (_) { return 'throw'; } }
    var root = document.getElementById('root');
    return 'env: React=' + t(window.React) + ' ReactDOM=' + t(window.ReactDOM) +
      ' createRoot=' + t(window.ReactDOM && window.ReactDOM.createRoot) +
      ' Plotly=' + t(window.Plotly) + ' katex=' + t(window.katex) +
      ' WebAssembly=' + t(window.WebAssembly) +
      ' root=' + (root ? 'present(' + root.childNodes.length + ' kids)' : 'MISSING') +
      ' electronAPI=' + t(window.electronAPI) + ' DEMO_EXAMPLES=' + t(window.DEMO_EXAMPLES);
  }

  // Loading splash — a several-MB first load over mobile is slow; a blank white
  // page looks broken. Show a centred "Loading…" with the build stamp (so the user
  // can confirm they're on a fresh deploy, not a cached old one) until React mounts.
  function splashShow() {
    try {
      if (!document.body || document.getElementById('tfs-demo-splash')) return;
      var build = (window.__TFS_BUILD__ || 'dev');
      var s = document.createElement('div');
      s.id = 'tfs-demo-splash';
      s.setAttribute('style', [
        'position:fixed', 'inset:0', 'z-index:2147483646', 'background:#ffffff',
        'color:#333', 'font:15px/1.5 system-ui,-apple-system,sans-serif',
        'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:10px',
      ].join(';'));
      s.innerHTML =
        '<div style="width:34px;height:34px;border:3px solid #d0d0d0;border-top-color:#6c5ce7;' +
        'border-radius:50%;animation:tfsspin 0.9s linear infinite"></div>' +
        '<div>Loading TFStudio…</div>' +
        '<div style="font-size:12px;color:#999">first load downloads a few MB — please wait</div>' +
        '<div style="font-size:11px;color:#bbb">build ' + build + '</div>' +
        '<style>@keyframes tfsspin{to{transform:rotate(360deg)}}</style>';
      document.body.appendChild(s);
    } catch (_) {}
  }
  function splashHide() {
    try { var s = document.getElementById('tfs-demo-splash'); if (s) s.remove(); } catch (_) {}
  }
  if (document.body) splashShow();
  else document.addEventListener('DOMContentLoaded', splashShow);

  // Load-timeline instrumentation — record env at the key lifecycle points so a
  // failure tells us exactly how far boot got (which scripts had executed when).
  log('boot', 'demo-boot running');
  document.addEventListener('DOMContentLoaded', function () { log('DOMContentLoaded', env()); });
  window.addEventListener('load', function () { log('window.load', env()); });

  // Poll for mount. AUTO-RECOVER: if React paints into #root at any point — even
  // after the watchdog fired — hide BOTH the splash and the error overlay, so a
  // merely-slow boot can never leave a stuck error screen over a working app.
  var elapsed = 0;
  (function poll() {
    try {
      var root = document.getElementById('root');
      if (root && root.childNodes.length > 0) {
        splashHide();
        var ov = document.getElementById('tfs-demo-error');
        if (ov) ov.remove();
        return; // booted
      }
    } catch (_) {}
    elapsed += 250;
    if (elapsed < 60000) setTimeout(poll, 250); // keep watching up to 60 s
  })();

  // Watchdog: only fires if React never mounted into #root. Threshold is generous
  // so a slow (but eventually-successful) vendor download isn't a false alarm.
  function check(n) {
    try {
      var root = document.getElementById('root');
      if (root && root.childNodes.length > 0) return; // booted OK — never paint
      if (n <= 0) { log('watchdog', '#root is still empty — the renderer did not mount.\n' + env()); show(); return; }
      setTimeout(function () { check(n - 1); }, 2000);
    } catch (_) {}
  }
  setTimeout(function () { check(8); }, 2000); // ~18 s grace
})();
