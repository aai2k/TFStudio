// IPC: check GitHub for a newer release.
//
// The request lives in the main process rather than the renderer so the
// renderer keeps no network access and its CSP stays untouched, matching how
// every other outbound request already works (see rii.js).
//
// Notify only. Nothing here downloads or installs anything; the renderer opens
// the Releases page in the user's browser.
//
// CommonJS, Electron-free (deps via ctx).
const RELEASES_API = 'https://api.github.com/repos/aai2k/TFStudio/releases/latest';

// Short by design: this runs at startup and must never delay the app. A slow
// network is reported as a timeout rather than kept waiting on.
const TIMEOUT_MS = 8000;
const MAX_BYTES = 1024 * 1024;

function register(ipcMain, ctx) {
  ipcMain.handle('updates:check', async () => handleCheck(ctx));
}

// Map a transport-level error to one of the reason codes the renderer knows.
function classifyError(err) {
  const code = err?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENETUNREACH' || code === 'ECONNREFUSED') {
    return 'offline';
  }
  if (err?.message === 'timeout') return 'timeout';
  return 'offline';
}

// GitHub answers a spent quota with 403 (or 429) plus x-ratelimit-remaining: 0.
// That is a failure, not "up to date" — the unauthenticated API allows 60
// requests/hour per IP, which a shared lab NAT can exhaust.
function classifyStatus(status, headers) {
  if (status === 200) return null;
  const remaining = headers?.['x-ratelimit-remaining'];
  if (status === 429 || (status === 403 && remaining === '0')) return 'rate-limited';
  return 'http-error';
}

function fetchLatestRelease() {
  const https = require('https');
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };

    const req = https.get(RELEASES_API, {
      headers: {
        // GitHub rejects requests without a User-Agent.
        'User-Agent': 'TFStudio',
        'Accept': 'application/vnd.github+json',
      },
    }, (res) => {
      const reason = classifyStatus(res.statusCode, res.headers);
      if (reason) { res.resume(); return finish({ ok: false, reason }); }

      let body = '';
      let total = 0;
      res.setEncoding('utf-8');
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_BYTES) { req.destroy(); return finish({ ok: false, reason: 'bad-response' }); }
        body += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          finish({
            ok: true,
            tag: json.tag_name,
            notes: json.body || '',
            url: json.html_url || 'https://github.com/aai2k/TFStudio/releases/latest',
            publishedAt: json.published_at || null,
          });
        } catch (_) {
          finish({ ok: false, reason: 'bad-response' });
        }
      });
    });

    req.on('error', (err) => finish({ ok: false, reason: classifyError(err) }));
    req.setTimeout(TIMEOUT_MS, () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
  });
}

async function handleCheck(ctx) {
  try {
    const result = await fetchLatestRelease();
    if (!result.ok) ctx.log(`updates:check failed (${result.reason})`);
    return { ...result, current: ctx.app.getVersion() };
  } catch (err) {
    ctx.log(`updates:check error: ${err.message}`);
    return { ok: false, reason: 'offline', current: ctx.app.getVersion() };
  }
}

module.exports = { register };
