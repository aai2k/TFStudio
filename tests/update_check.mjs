/**
 * Update-check decision logic (src/utils/updateCheck.js).
 *
 * The rule that matters most: a check that did not succeed must never be
 * reported as "up to date". Telling a user they are current when the request
 * was rate-limited or the tag was unparsable is worse than saying nothing.
 */
const { parseVersion, compareVersions, normalizeTag, decideUpdateState,
        shouldNotify, truncateNotes, FAILURE_REASONS } =
  await import(new URL('../src/utils/updateCheck.js', import.meta.url));

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}
const sign = (n) => (n === null ? null : Math.sign(n));

// ── Parsing ─────────────────────────────────────────────────────────────────
{
  ok(parseVersion('1.4.3').major === 1, 'parses major');
  ok(parseVersion('1.4.3').minor === 4, 'parses minor');
  ok(parseVersion('1.4.3').patch === 3, 'parses patch');
  ok(parseVersion('v1.4.3').patch === 3, 'accepts a v prefix');
  ok(parseVersion(' 1.4.3 ').patch === 3, 'tolerates surrounding whitespace');
  ok(parseVersion('2').major === 2 && parseVersion('2').minor === 0, 'a bare major is 2.0.0');
  ok(parseVersion('1.5').minor === 5 && parseVersion('1.5').patch === 0, 'a two-part version is x.y.0');
  ok(parseVersion('1.5.0-rc.1').prerelease === 'rc.1', 'captures a prerelease suffix');
  ok(parseVersion('1.5.0+build.7').prerelease === null, 'build metadata is not a prerelease');

  ok(parseVersion('') === null, 'empty string is not a version');
  ok(parseVersion(null) === null, 'null is not a version');
  ok(parseVersion(undefined) === null, 'undefined is not a version');
  ok(parseVersion('nightly') === null, 'a word is not a version');
  ok(parseVersion('v') === null, 'a bare v is not a version');
  ok(parseVersion(1.43) === null, 'a number is not a version');

  // The trap the plan calls out: Number('') is 0 and Number('rc') is NaN, so a
  // naive split-and-Number comparator produces NaN and every comparison with
  // it is false, which reads as "up to date".
  const parsed = parseVersion('1.5.0-rc.1');
  ok(Number.isFinite(parsed.major) && Number.isFinite(parsed.minor) && Number.isFinite(parsed.patch),
    'a prerelease tag yields no NaN parts');
}

// ── Comparison ──────────────────────────────────────────────────────────────
{
  ok(sign(compareVersions('1.4.3', '1.5.0')) === -1, 'older minor is less');
  ok(sign(compareVersions('1.5.0', '1.4.3')) === 1, 'newer minor is greater');
  ok(compareVersions('1.4.3', '1.4.3') === 0, 'equal versions compare equal');
  ok(compareVersions('1.4.3', 'v1.4.3') === 0, 'the v prefix does not affect ordering');
  ok(sign(compareVersions('1.4.3', '1.4.10')) === -1, 'patch compares numerically, not as text');
  ok(sign(compareVersions('1.9.0', '1.10.0')) === -1, 'minor compares numerically, not as text');
  ok(sign(compareVersions('2.0.0', '1.999.999')) === 1, 'major dominates');

  // A prerelease precedes its own release.
  ok(sign(compareVersions('1.5.0-rc.1', '1.5.0')) === -1, 'rc is older than the release');
  ok(sign(compareVersions('1.5.0', '1.5.0-rc.1')) === 1, 'the release is newer than its rc');
  ok(sign(compareVersions('1.5.0-rc.1', '1.5.0-rc.2')) === -1, 'rc.1 precedes rc.2');
  ok(sign(compareVersions('1.5.0-rc.2', '1.5.0-rc.10')) === -1,
    'numeric prerelease identifiers compare numerically');
  ok(sign(compareVersions('1.5.0-alpha.2', '1.5.0-alpha.10')) === -1,
    'multi-part prereleases compare numeric identifiers numerically');
  ok(sign(compareVersions('1.5.0-alpha.1', '1.5.0-alpha.beta')) === -1,
    'numeric prerelease identifiers precede text identifiers');
  ok(sign(compareVersions('1.5.0-alpha', '1.5.0-alpha.1')) === -1,
    'a shorter matching prerelease precedes a longer one');
  ok(compareVersions('1.5.0-rc.1', '1.5.0-rc.1') === 0, 'identical prereleases compare equal');
  ok(compareVersions('1.5.0+build.1', '1.5.0+build.2') === 0,
    'build metadata does not affect precedence');

  ok(compareVersions('1.4.3', 'garbage') === null, 'an unparsable side yields null');
  ok(compareVersions(null, '1.4.3') === null, 'a missing side yields null');

  ok(normalizeTag('v1.4.3') === '1.4.3', 'normalizeTag strips the v');
  ok(normalizeTag('1.4.3') === '1.4.3', 'normalizeTag leaves a bare tag alone');
  ok(normalizeTag(undefined) === '', 'normalizeTag copes with nothing');
}

// ── Decision: update available ──────────────────────────────────────────────
{
  const decision = decideUpdateState({
    current: '1.4.3',
    result: { ok: true, tag: '1.5.0', notes: 'Some notes', url: 'https://example.invalid' },
  });
  ok(decision.state === 'available', 'a newer release is available');
  ok(decision.current === '1.4.3' && decision.latest === '1.5.0', 'both versions are reported');
  ok(decision.notes === 'Some notes', 'notes are carried');
  ok(shouldNotify(decision), 'an available update notifies on startup');

  const prefixed = decideUpdateState({ current: '1.4.3', result: { ok: true, tag: 'v1.5.0' } });
  ok(prefixed.state === 'available', 'a v-prefixed tag is still recognised as newer');
  ok(prefixed.latest === '1.5.0', 'the reported version drops the v');
  ok(prefixed.notes === '', 'missing notes become an empty string, never undefined');
}

// ── Decision: up to date ────────────────────────────────────────────────────
{
  const same = decideUpdateState({ current: '1.5.0', result: { ok: true, tag: '1.5.0' } });
  ok(same.state === 'up-to-date', 'the same version is up to date');
  ok(!shouldNotify(same), 'up to date does not interrupt on startup');
  ok(shouldNotify({ ...same, manual: true }), 'a manual check reports up to date');

  const ahead = decideUpdateState({ current: '1.6.0', result: { ok: true, tag: '1.5.0' } });
  ok(ahead.state === 'up-to-date', 'a local build ahead of the release is up to date');

  // A released build is newer than the rc the user is running.
  const fromRc = decideUpdateState({ current: '1.5.0-rc.1', result: { ok: true, tag: '1.5.0' } });
  ok(fromRc.state === 'available', 'an rc user is offered the final release');
}

// ── Decision: failures never read as up to date ─────────────────────────────
{
  for (const reason of FAILURE_REASONS) {
    const decision = decideUpdateState({ current: '1.4.3', result: { ok: false, reason } });
    ok(decision.state === 'failed', `${reason} classifies as failed`);
    ok(decision.reason === reason, `${reason} is reported back`);
    ok(decision.state !== 'up-to-date', `${reason} is never reported as up to date`);
  }

  ok(decideUpdateState({ current: '1.4.3', result: null }).state === 'failed',
    'a missing result is a failure');
  ok(decideUpdateState({ current: '1.4.3', result: { ok: false, reason: 'weird' } }).reason === 'bad-response',
    'an unknown reason falls back to bad-response');

  // An unparsable tag must not be silently treated as "no newer version".
  const badTag = decideUpdateState({ current: '1.4.3', result: { ok: true, tag: 'nightly-build' } });
  ok(badTag.state === 'failed', 'an unparsable tag is a failure, not up to date');
  const missingTag = decideUpdateState({ current: '1.4.3', result: { ok: true } });
  ok(missingTag.state === 'failed', 'a missing tag is a failure, not up to date');

  ok(shouldNotify({ state: 'failed', manual: false }), 'a startup failure is reported');
}

// ── Decision: the skip list ─────────────────────────────────────────────────
{
  const auto = decideUpdateState({
    current: '1.4.3', result: { ok: true, tag: '1.5.0' }, skipped: '1.5.0',
  });
  ok(auto.state === 'skipped', 'a skipped version does not notify automatically');
  ok(!shouldNotify(auto), 'skipped never surfaces a card');

  const manual = decideUpdateState({
    current: '1.4.3', result: { ok: true, tag: '1.5.0' }, skipped: '1.5.0', manual: true,
  });
  ok(manual.state === 'available', 'a manual check ignores the skip list');
  ok(shouldNotify(manual), 'the manual result is shown');

  // Skipping one version must not suppress a later, higher one.
  const higher = decideUpdateState({
    current: '1.4.3', result: { ok: true, tag: '1.6.0' }, skipped: '1.5.0',
  });
  ok(higher.state === 'available', 'a higher version still notifies after an earlier skip');

  const prefixSkip = decideUpdateState({
    current: '1.4.3', result: { ok: true, tag: '1.5.0' }, skipped: 'v1.5.0',
  });
  ok(prefixSkip.state === 'skipped', 'the skip list tolerates a v prefix');

  const junkSkip = decideUpdateState({
    current: '1.4.3', result: { ok: true, tag: '1.5.0' }, skipped: 'not-a-version',
  });
  ok(junkSkip.state === 'available', 'an unparsable skip entry does not suppress the notice');
}

// ── Notes truncation ────────────────────────────────────────────────────────
{
  ok(truncateNotes('short') === 'short', 'short notes pass through');
  ok(truncateNotes('') === '', 'empty notes stay empty');
  ok(truncateNotes(null) === '', 'missing notes become an empty string');
  const long = 'word '.repeat(200);
  const cut = truncateNotes(long);
  ok(cut.length <= 321, 'long notes are truncated');
  ok(cut.endsWith('…'), 'truncation is marked with an ellipsis');
  ok(!cut.includes('  '), 'truncation does not leave a dangling space');
}

console.log(`update_check: ${passed} passed`);
