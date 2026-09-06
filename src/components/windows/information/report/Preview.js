/**
 * The page as it will print, in a sandboxed frame scaled to the width on hand.
 * The frame is laid out at the paper's own width and shrunk as a whole, so
 * the preview shows the real line breaks and column flow.
 */

import { CenteredMessage } from '../../analysis/chrome/layout.js';
import { observeResize } from '../../../ui/observeResize.js';
import { PAPERS } from '../../../../utils/report/template.js';

const { createElement: h, useEffect, useRef, useState } = React;

// Paper width in CSS px at 96 dpi plus the page margin the stylesheet draws.
const FRAME_WIDTH = { A4: 794 + 24, Letter: 816 + 24 };

export function Preview({ c, W, html, error, paper }) {
    const ref = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    useEffect(() => {
        const observer = observeResize(ref.current, entries => {
            const rect = entries[0]?.contentRect;
            if (rect) setSize({ width: rect.width, height: rect.height });
        });
        return () => observer?.disconnect();
    }, []);

    // The frame reloads with every new document, which would send the reader
    // back to the top. The frame is same-origin, and runs no scripts, so the
    // position can be followed as it scrolls and put back once the next
    // document has loaded.
    const frame = useRef(null);
    const scrollTop = useRef(0);
    const onLoad = () => {
        const view = frame.current?.contentWindow;
        if (!view) return;
        view.scrollTo(0, scrollTop.current);
        view.addEventListener('scroll', () => { scrollTop.current = view.scrollY; });
    };

    const frameWidth = FRAME_WIDTH[paper in PAPERS ? paper : 'A4'];
    const scale = size.width ? Math.min(1, size.width / frameWidth) : 1;
    const frameHeight = size.height ? size.height / scale : 0;
    return h('div', {
        ref,
        style: { flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', backgroundColor: c.field, position: 'relative' },
    },
        error
            ? h(CenteredMessage, { c, message: W.previewFailed(error) })
            : h('iframe', {
                ref: frame, title: 'report', srcDoc: html, sandbox: 'allow-same-origin', onLoad,
                style: {
                    display: 'block', border: 'none', backgroundColor: '#eceef1',
                    width: frameWidth, height: frameHeight || '100%',
                    transform: `scale(${scale})`, transformOrigin: 'top left',
                },
            }),
    );
}
