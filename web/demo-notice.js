// web/demo-notice.js — tells the visitor where their work is actually kept.
//
// The demo stores designs, catalogs and presets in this browser's IndexedDB.
// That is durable enough to work in, but it is not an account: nothing syncs
// between machines or browsers, and clearing site data erases it. Saving looks
// exactly like saving in the desktop application, so without a word from us a
// visitor can reasonably assume their work is safe somewhere.
//
// Shown after the first successful save rather than on load: that is the moment
// the assumption forms, and it keeps the notice away from people who are only
// looking around.
//
// Exposes window.DemoNotice. English only — the demo layer carries no
// translation table, and guessing optics terminology in another language is
// worse than plain English.

(function () {
  'use strict';

  const SEEN_KEY = 'tfstudio.demo.storageNoticeSeen';
  const ID = 'tfs-demo-notice';

  // A browser that refuses storage loses the work on reload, so that warning
  // returns each session; the ordinary "kept in this browser" note is a
  // one-time thing.
  function alreadyShown(persistent) {
    try {
      return persistent
        ? localStorage.getItem(SEEN_KEY) === '1'
        : sessionStorage.getItem(SEEN_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function markShown(persistent) {
    try {
      if (persistent) localStorage.setItem(SEEN_KEY, '1');
      else sessionStorage.setItem(SEEN_KEY, '1');
    } catch (_) { /* storage disabled; the notice simply repeats */ }
  }

  function render(title, body, autoHideMs) {
    if (document.getElementById(ID)) return;

    const box = document.createElement('div');
    box.id = ID;
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    // Fixed and self-contained: the application paints its own theme with inline
    // styles, so this deliberately does not try to inherit one.
    box.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:44px', 'z-index:2147483000',
      'max-width:360px', 'padding:12px 14px',
      'background:#1f2430', 'color:#e8eaf0',
      'border:1px solid rgba(255,255,255,.14)', 'border-radius:8px',
      'box-shadow:0 6px 24px rgba(0,0,0,.35)',
      'font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
    ].join(';');

    const heading = document.createElement('div');
    heading.textContent = title;
    heading.style.cssText = 'font-weight:600;margin-bottom:4px';

    const text = document.createElement('div');
    text.textContent = body;
    text.style.cssText = 'opacity:.85';

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Got it';
    close.style.cssText = [
      'margin-top:10px', 'padding:4px 10px', 'cursor:pointer',
      'background:transparent', 'color:#9db4ff',
      'border:1px solid rgba(157,180,255,.4)', 'border-radius:5px',
      'font:inherit',
    ].join(';');

    const dismiss = () => { try { box.remove(); } catch (_) {} };
    close.addEventListener('click', dismiss);

    box.appendChild(heading);
    box.appendChild(text);
    box.appendChild(close);
    document.body.appendChild(box);

    if (autoHideMs) setTimeout(dismiss, autoHideMs);
  }

  // Call after a save succeeds. Does nothing on later calls.
  function storageWarningOnce(persistent) {
    try {
      if (alreadyShown(persistent)) return;
      markShown(persistent);
      if (persistent) {
        render(
          'Saved in this browser',
          'Your designs, catalogs and presets are kept in this browser only. '
          + 'They do not sync to other devices, and clearing site data removes them. '
          + 'The desktop version stores them as files you own. '
          + 'This demo counts anonymous usage events so we can tell whether anyone '
          + 'is using it; your designs are never sent anywhere. The desktop version '
          + 'sends nothing at all.',
          16000,
        );
      } else {
        render(
          'This work will not be saved',
          'Your browser is blocking local storage, so anything you create here is '
          + 'lost when you reload or close the tab. Private-browsing modes are the '
          + 'usual cause.',
          0,
        );
      }
    } catch (_) { /* a notice must never break the application */ }
  }

  window.DemoNotice = { storageWarningOnce };
})();
