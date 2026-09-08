// ── Can this app put a window where it wants it? ─────────────────────────────
//
// A torn-off tool draws its own title bar and moves its own window rather than
// handing the gesture to the OS, because the drag has to light the layout's drop
// targets as it passes over them and an OS-run move delivers no mouse events to
// the renderer. See the window-move handler in ipc/appWindow.js. All of it rests
// on the app being allowed to say where a window goes.
//
// Wayland does not allow it. xdg-shell has no request for a client to place its
// own toplevel, and nothing in the app can tell: Chromium remembers the origin
// it was handed and gives it straight back, so `setBounds({x, y})` is accepted,
// `getBounds` returns it unchanged, and the renderer's `screenX`/`screenY`,
// derived from that same remembered origin, track it exactly. Every number the
// app can see agrees with every other, and the window does not move.
//
// Measured on this Ubuntu GNOME session with Electron 44: a torn-off window sent
// to (100,100), (700,500) and (300,250) in turn reported each position back
// faithfully, while screenshots taken by the compositor put it at the same
// pixels all three times and the three frames differed by not one pixel. Under
// --ozone-platform=x11 on the same session it went exactly where it was asked.
// That is why no unit test over a fake window can catch this: the arithmetic is
// right, and the platform declines to carry it out.
//
// Electron-free and dependency-free, so it can be require()d in plain Node.

// Where the app cannot place a window, the compositor must move it, and the
// strip becomes a native drag region instead (see FloatFrame). That costs
// dragging a window home onto a drop target; the Dock button still does it.
function canPlaceOwnWindows({ platform = process.platform, env = process.env, argv = process.argv } = {}) {
  if (platform !== 'linux') return true;
  return !usesWayland(env, argv);
}

// Which Ozone backend Electron will have chosen. An explicit --ozone-platform
// settles it; failing that --ozone-platform-hint; failing both, Electron takes
// the Wayland session when the machine offers one.
//
// The guess leans towards Wayland on purpose. Reading X11 as Wayland costs only
// dragging a window home, which the Dock button also does; reading Wayland as
// X11 brings back a window that cannot be moved at all.
function usesWayland(env = {}, argv = []) {
  const chosen = switchValue(argv, 'ozone-platform');
  if (chosen) return chosen === 'wayland';
  if (switchValue(argv, 'ozone-platform-hint') === 'x11') return false;
  // Either signal alone is enough: WAYLAND_DISPLAY can be unset and libwayland
  // will still find `wayland-0`, and a compositor may set only the socket.
  return !!env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === 'wayland';
}

// Last one wins, as Chromium's own switch parsing does.
function switchValue(argv, name) {
  const prefix = `--${name}=`;
  let value = null;
  for (const arg of argv || []) {
    if (typeof arg === 'string' && arg.startsWith(prefix)) value = arg.slice(prefix.length);
  }
  return value;
}

module.exports = { canPlaceOwnWindows, usesWayland };
