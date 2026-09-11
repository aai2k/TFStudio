/**
 * The material-range warning for an optimizer window, as the badge the analysis
 * windows carry on their control row. It is checked against the wavelengths the
 * merit function evaluates rather than a plot axis, and renders nothing while
 * every material covers what the targets reach.
 */
import { NoticeBadge } from '../../analysis/chrome/popover.js';
import { useMeritRangeNotice } from '../../../materials/MaterialRangeNotice.js';

const { createElement: h } = React;

export function MeritRangeBadge({ design, c, t }) {
    const notice = useMeritRangeNotice(design, t);
    return h(NoticeBadge, { c, notices: [notice].filter(Boolean), label: t.analysisChrome.notices });
}
