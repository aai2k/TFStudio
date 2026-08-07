/**
 * Update-check state machine.
 *
 * Runs one check shortly after startup (unless turned off in Settings), and on
 * demand from the title-bar badge. Notify only — nothing here downloads or
 * installs.
 *
 * Two behaviours exist to keep this from becoming a nag:
 *   • The startup failure card auto-dismisses, and appears at most once per app
 *     version. A permanently offline machine — a realistic case for an
 *     air-gapped deposition-lab PC — would otherwise see it on every launch,
 *     which is how users learn to ignore notifications. The badge keeps the
 *     state, with the reason on hover.
 *   • A card is never raised while an optimization is running; it waits until
 *     the run finishes.
 * A manual check always reports in full, including "up to date", so the badge
 * never looks broken, and it ignores the skip list.
 */
import { decideUpdateState, shouldNotify } from '../../utils/updateCheck.js';

const { useState, useEffect, useCallback, useRef } = React;

const STARTUP_DELAY_MS = 4000;
const FAILURE_CARD_MS = 6000;
const RELEASES_URL = 'https://github.com/aai2k/TFStudio/releases/latest';

async function requestCheck() {
  if (!window.electronAPI?.checkForUpdates) return null;
  try {
    return await window.electronAPI.checkForUpdates();
  } catch (_) {
    return { ok: false, reason: 'offline' };
  }
}

// Status the badge renders: 'idle' | 'checking' | 'available' | 'failed'.
function statusFor(decision, checking) {
  if (checking) return 'checking';
  if (decision?.state === 'available') return 'available';
  if (decision?.state === 'failed') return 'failed';
  return 'idle';
}

// A startup failure is reported at most once per app version.
function failureAlreadyReported(appVersion) {
  const key = `tfstudio.updateFailureSeen.${appVersion}`;
  try {
    if (localStorage.getItem(key) === '1') return true;
    localStorage.setItem(key, '1');
  } catch (_) { /* no localStorage → report it */ }
  return false;
}

function worthRaising(decision, appVersion) {
  if (!decision || !shouldNotify(decision)) return false;
  if (decision.state === 'failed' && !decision.manual) return !failureAlreadyReported(appVersion);
  return true;
}

// Hold a card back while an optimization is running, then release it.
function useDeferredCard(isOptimizing) {
  const [card, setCard] = useState(null);
  const pending = useRef(null);

  useEffect(() => {
    if (isOptimizing || !pending.current) return;
    setCard(pending.current);
    pending.current = null;
  }, [isOptimizing]);

  const show = useCallback((next) => {
    if (isOptimizing) { pending.current = next; return; }
    setCard(next);
  }, [isOptimizing]);

  return [card, show, () => setCard(null)];
}

// The startup failure card gets out of the way on its own; the badge keeps it.
function useAutoDismiss(card, dismiss) {
  useEffect(() => {
    if (!card || card.state !== 'failed' || card.manual) return;
    const timer = setTimeout(dismiss, FAILURE_CARD_MS);
    return () => clearTimeout(timer);
  }, [card]);   // eslint-disable-line react-hooks/exhaustive-deps
}

export function useUpdateCheck({ enabled, skippedVersion, onSkipVersion, isOptimizing, appVersion }) {
  const [decision, setDecision] = useState(null);
  const [checking, setChecking] = useState(false);
  const [card, showCard, hideCard] = useDeferredCard(isOptimizing);
  const started = useRef(false);

  const run = useCallback(async (manual) => {
    setChecking(true);
    const result = await requestCheck();
    setChecking(false);
    if (result === null) return null;
    const next = decideUpdateState({
      current: result.current || appVersion,
      result,
      skipped: skippedVersion,
      manual,
    });
    setDecision(next);
    return next;
  }, [skippedVersion, appVersion]);

  useEffect(() => {
    if (started.current || !enabled) return;
    started.current = true;
    const timer = setTimeout(async () => {
      const next = await run(false);
      if (worthRaising(next, appVersion)) showCard(next);
    }, STARTUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, run, showCard, appVersion]);

  useAutoDismiss(card, hideCard);

  const checkNow = useCallback(async () => {
    const next = await run(true);
    if (next) showCard(next);
  }, [run, showCard]);

  // Clicking the badge reopens a known result rather than re-checking when an
  // update is already waiting.
  const onBadgeClick = useCallback(() => {
    if (decision?.state === 'available') showCard(decision);
    else checkNow();
  }, [decision, checkNow, showCard]);

  const skip = useCallback((version) => {
    onSkipVersion?.(version);
    setDecision(current => (current ? { ...current, state: 'skipped' } : current));
  }, [onSkipVersion]);

  const openReleases = useCallback(() => {
    window.electronAPI?.openExternal?.(decision?.url || RELEASES_URL);
  }, [decision]);

  return {
    card,
    status: statusFor(decision, checking),
    latest: decision?.latest || null,
    dismiss: hideCard,
    checkNow,
    onBadgeClick,
    skip,
    openReleases,
  };
}
