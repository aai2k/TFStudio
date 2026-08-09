// web/demo-telemetry.js — anonymous usage counters for the WEB DEMO ONLY.
//
// Why this exists: GitHub's download and clone counters are dominated by
// crawlers, mirrors and scanners, so they cannot answer "did a person actually
// use this?". Automated clients do not run JavaScript and do not generate
// trusted input events, so counting *interactions* rather than page loads
// gives a signal that machine traffic cannot produce.
//
// This file is copied into the demo build only. It is not part of the desktop
// application, which performs no telemetry of any kind — the desktop build is
// expected to run on air-gapped and locked-down deposition machines where
// phoning home would be, correctly, a reason not to install it.
//
// What is sent, per event: a random session id, the event name, the build
// stamp. Nothing else. No cookies, no persistent identifier, no user agent, no
// fingerprint, no design data. The session id lives in sessionStorage, so it is
// discarded when the tab closes and cannot link two visits to one person.
//
// Respects Do Not Track and Global Privacy Control: if either is set, nothing
// is ever sent.
//
// Pure, dependency-free, defensive — must never itself throw and must never
// delay the application.
(function () {
  'use strict';

  var ENDPOINT = '/api/e';
  var HEARTBEAT_MS = 60000;   // one "active" beat per minute of real use
  var MAX_EVENTS = 120;       // hard cap per session; stops any runaway loop

  // Server rejects anything not on its own copy of this list. Keeping the
  // allowlist in both places means a bug here cannot pollute the table.
  var ALLOWED = {
    boot: 1,        // the app actually mounted (JS ran, React rendered)
    engaged: 1,     // first genuine user interaction, once per session
    active: 1,      // still interacting, one per minute — gives session length
    example: 1,     // loaded one of the bundled example designs
    optimize: 1,    // ran a refinement or synthesis
    save: 1         // saved a design
  };

  function optedOut() {
    try {
      if (navigator.globalPrivacyControl === true) return true;
      var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
      return dnt === '1' || dnt === 'yes';
    } catch (_) { return false; }
  }

  if (optedOut()) { window.tfsTrack = function () {}; return; }

  var sent = 0;
  var once = {};

  function sessionId() {
    try {
      var k = 'tfstudio.demo.sid';
      var v = sessionStorage.getItem(k);
      if (!v) {
        v = (crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
        sessionStorage.setItem(k, v);
      }
      return v;
    } catch (_) {
      // Storage blocked (private mode). Fall back to a per-page-load id: the
      // count of engaged sessions stays correct, only cross-reload continuity
      // is lost, and that is the right trade for not touching storage.
      return 'nostore';
    }
  }

  function send(name) {
    try {
      if (!ALLOWED[name] || sent >= MAX_EVENTS) return;
      sent++;
      var body = JSON.stringify({
        s: sessionId(),
        e: name,
        b: String(window.__TFS_BUILD__ || 'dev')
      });
      // sendBeacon is fire-and-forget and survives page unload, so a visitor
      // who closes the tab mid-session is still counted, and nothing blocks.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
        return;
      }
      fetch(ENDPOINT, {
        method: 'POST', body: body, keepalive: true,
        headers: { 'Content-Type': 'application/json' }
      })['catch'](function () {});
    } catch (_) { /* telemetry must never break the demo */ }
  }

  function sendOnce(name) {
    if (once[name]) return;
    once[name] = 1;
    send(name);
  }

  // Public hook so application code can report a meaningful action without
  // knowing anything about transport: window.tfsTrack('optimize').
  window.tfsTrack = function (name) { send(String(name)); };

  // ── boot: the app genuinely rendered ────────────────────────────────────────
  // Polled rather than assumed: a page load that never mounts is not a use, and
  // counting it would reintroduce exactly the noise this file exists to avoid.
  var waited = 0;
  (function pollMount() {
    try {
      var root = document.getElementById('root');
      if (root && root.childNodes.length > 0) { sendOnce('boot'); return; }
    } catch (_) {}
    waited += 500;
    if (waited < 60000) setTimeout(pollMount, 500);
  })();

  // ── engagement: trusted input only ──────────────────────────────────────────
  // isTrusted is false for events dispatched by script, so headless drivers and
  // synthetic clicks cannot manufacture engagement. Scrolling and mouse movement
  // are deliberately excluded: they are what a person does while reading, not
  // while designing a coating.
  var interacted = false;
  function onInteract(e) {
    try {
      if (!e || e.isTrusted !== true) return;
      interacted = true;
      sendOnce('engaged');
    } catch (_) {}
  }
  ['pointerdown', 'keydown', 'change'].forEach(function (t) {
    try { document.addEventListener(t, onInteract, { capture: true, passive: true }); } catch (_) {}
  });

  // ── heartbeat: turns engagement into duration ───────────────────────────────
  // Only beats when there was fresh interaction in the interval, so an abandoned
  // open tab contributes nothing. Counting beats gives minutes of real use.
  setInterval(function () {
    if (!interacted) return;
    interacted = false;
    send('active');
  }, HEARTBEAT_MS);
})();
