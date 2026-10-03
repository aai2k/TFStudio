/**
 * What the last action in an import window did, such as a curve added or
 * changed, a file read, a target built or a file written, shown in plain sight
 * at the end of the window's control row, beside the notice badge.
 *
 * The badge holds the conditions attached to what the window shows and opens
 * only on a click. A report of an action is not one of them, and a success put
 * there would sit behind a warning icon with a count.
 *
 * A success or a note clears itself after a few seconds. A warning or an error
 * stays until the next action reports or a new import starts, so it is not
 * gone before it is read.
 */
import { NoticeBadge } from '../../analysis/chrome/popover.js';

const { createElement: h, useCallback, useEffect, useRef, useState } = React;

// Long enough to read a one-line report; the Report window gives its own the same.
const CLEAR_AFTER_MS = 4000;
const CLEARS_ITSELF = new Set(['success', 'info']);

// The theme colour of each kind of report, as the notice badge colours them.
const TONE_COLOR = { success: 'success', info: 'accent', warning: 'warning', error: 'error' };

/**
 * The window's report line.
 *
 * @returns {{ status, flash, clear }}
 *   status            { type, msg } or null, `type` one of success, info,
 *                     warning, error
 *   flash(type, msg)  report what an action did
 *   clear()           take the report down
 */
export function useActionStatus() {
    const [status, setStatus] = useState(null);
    // One timer, so an earlier report's expiry cannot clear a later one, and
    // nothing fires after the window is gone.
    const timer = useRef(null);
    const clear = useCallback(() => {
        clearTimeout(timer.current);
        setStatus(null);
    }, []);
    const flash = useCallback((type, msg) => {
        clearTimeout(timer.current);
        setStatus({ type, msg });
        if (CLEARS_ITSELF.has(type)) timer.current = setTimeout(() => setStatus(null), CLEAR_AFTER_MS);
    }, []);
    useEffect(() => () => clearTimeout(timer.current), []);
    return { status, flash, clear };
}

// The report itself. Its full text is its tooltip, for a window too narrow to
// show all of it.
function ActionStatus({ c, status }) {
    const color = c[TONE_COLOR[status.type]] || c.textDim;
    return h('div', {
        role: 'status', title: status.msg,
        style: {
            minWidth: 0, height: 28, lineHeight: '28px', padding: '0 8px', borderRadius: 6,
            fontSize: 11, color, backgroundColor: color + (c.light ? '20' : '30'),
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        },
    }, status.msg);
}

/**
 * The right-hand end of an import window's control row: the last action's
 * report, then the notice badge. The two share one box, passed as the row's
 * last child, which moves to a line of its own when it does not fit beside the
 * tabs; the report is cut short only when it is wider than the whole row.
 *
 *   status   from useActionStatus
 *   notices  the conditions, as NoticeBadge takes them
 */
export function ReportAndNotices({ c, t, status, notices }) {
    return h('div', {
        style: { marginLeft: 'auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
    },
        status && h(ActionStatus, { c, status }),
        h(NoticeBadge, { c, notices, label: t.analysisChrome.notices }),
    );
}
