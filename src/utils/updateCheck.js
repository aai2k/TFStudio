/**
 * Update-check decision logic. Pure — no network, no Electron.
 *
 * The app checks whether a newer release exists and says so; downloading and
 * installing stay manual. Everything here is about deciding what to tell the
 * user, given the running version, whatever GitHub returned, and the version
 * they previously chose to ignore.
 */

// Release tags in this repo are bare numbers ("1.4.3"). A leading "v" is
// accepted anyway so the check keeps working if the tag style ever changes.
const VERSION_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * Parse a version string into comparable parts.
 * @returns {{major:number, minor:number, patch:number, prerelease:string|null}|null}
 *          null when the string is missing or not a version at all.
 */
export function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = VERSION_RE.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    minorGiven: match[2] !== undefined,
    patch: match[3] === undefined ? 0 : Number(match[3]),
    prerelease: match[4] || null,
  };
}

// Semver §11: a numeric identifier compares numerically and ranks below an
// alphanumeric one; otherwise ASCII order. BigInt keeps rc.10 above rc.9
// however long the number grows.
const NUMERIC_IDENTIFIER = /^\d+$/;

function compareIdentifier(left, right) {
  if (left === right) return 0;

  const leftNumeric = NUMERIC_IDENTIFIER.test(left);
  const rightNumeric = NUMERIC_IDENTIFIER.test(right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  if (leftNumeric) return BigInt(left) < BigInt(right) ? -1 : 1;
  return left < right ? -1 : 1;
}

// A prerelease sorts *below* the release of the same numbers: 1.5.0-rc.1 is
// older than 1.5.0. Comparing the numeric parts alone would call them equal,
// so an rc user would never be offered the final build.
function comparePrerelease(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;    // release beats prerelease
  if (b === null) return -1;

  const left = a.split('.');
  const right = b.split('.');
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index++) {
    const order = compareIdentifier(left[index], right[index]);
    if (order !== 0) return order;
  }

  // When every shared identifier is equal, the shorter prerelease precedes
  // the longer one (for example, alpha < alpha.1).
  return left.length - right.length;
}

/**
 * Compare two version strings.
 * @returns {number|null} negative if a < b, 0 if equal, positive if a > b;
 *                        null when either side cannot be parsed.
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  return comparePrerelease(left.prerelease, right.prerelease);
}

/** Display form of a tag, without the optional leading "v". */
export function normalizeTag(tag) {
  return typeof tag === 'string' ? tag.trim().replace(/^v/, '') : '';
}

// Reasons a check can fail. Rate-limiting is a failure, never "up to date":
// the unauthenticated GitHub API allows 60 requests/hour per IP, which a shared
// lab NAT can exhaust, and reporting "up to date" then would be a lie.
export const FAILURE_REASONS = ['offline', 'timeout', 'rate-limited', 'http-error', 'bad-response'];

/**
 * Decide what to show the user.
 *
 * @param {object} input
 * @param {string} input.current          running version, from app.getVersion()
 * @param {object|null} input.result      main-process result: {ok:true, tag, notes, url}
 *                                        or {ok:false, reason}
 * @param {string|null} [input.skipped]   version the user chose to ignore
 * @param {boolean} [input.manual]        true for a user-initiated re-check
 * @returns {{state:string, ...}} state is one of
 *          'available' | 'up-to-date' | 'skipped' | 'failed'
 */
export function decideUpdateState({ current, result, skipped = null, manual = false }) {
  if (!result || result.ok !== true) {
    const reason = FAILURE_REASONS.includes(result?.reason) ? result.reason : 'bad-response';
    return { state: 'failed', reason, manual };
  }

  const latest = normalizeTag(result.tag);
  const order = compareVersions(current, latest);

  // A tag we cannot parse is a failure, not "up to date" — silently claiming
  // the user is current because the release was tagged oddly is the worst
  // outcome available here.
  if (order === null) return { state: 'failed', reason: 'bad-response', manual };

  if (order >= 0) return { state: 'up-to-date', current, latest, manual };

  // An explicit re-check overrides the skip list: asking is a statement that
  // you want to know, even about a version you ignored earlier.
  //
  // The null check is load-bearing. compareVersions returns null for an entry
  // it cannot parse, and `null <= 0` is true in JavaScript, so without it a
  // corrupt skip entry would silently suppress every future notification.
  if (!manual && skipped) {
    const versusSkipped = compareVersions(latest, normalizeTag(skipped));
    if (versusSkipped !== null && versusSkipped <= 0) {
      return { state: 'skipped', current, latest, manual };
    }
  }

  return {
    state: 'available',
    current,
    latest,
    notes: typeof result.notes === 'string' ? result.notes : '',
    url: typeof result.url === 'string' ? result.url : '',
    manual,
  };
}

/** Whether a decision should surface a card. */
export function shouldNotify(decision) {
  if (decision.state === 'skipped') return false;
  // On startup only an available update is worth interrupting for; a manual
  // check always reports, so the button never looks broken.
  return decision.manual || decision.state === 'available' || decision.state === 'failed';
}

/** Truncate release notes for the card preview, on a word boundary. */
export function truncateNotes(notes, limit = 320) {
  const text = String(notes || '').trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastBreak = cut.lastIndexOf(' ');
  return `${(lastBreak > limit * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd()}…`;
}

function plainMarkdownLine(line) {
  return line
    .replace(/^[-*+]\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract compact, plain-text highlights from a Markdown release body. */
export function releaseHighlights(notes, limit = 3) {
  const lines = String(notes || '').split(/\r?\n/).map(line => line.trim());
  let candidates = lines.filter(line => /^[-*+]\s+/.test(line));
  if (candidates.length === 0) {
    candidates = lines.filter(line => line && !/^#{1,6}\s/.test(line) && !/^[-*_]{3,}$/.test(line));
  }
  return candidates
    .map(plainMarkdownLine)
    .filter(Boolean)
    .slice(0, Math.max(0, limit))
    .map(line => truncateNotes(line, 150));
}
