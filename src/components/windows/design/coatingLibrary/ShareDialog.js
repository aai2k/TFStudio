import {
    CONTRIBUTE_EMAIL, conditionsText, issueUrl, layerTable, mailUrl, packCoating,
} from '../../../../utils/coatingLibrary/share.js';
import { FONT, buttonStyle } from './ui.js';

const { createElement: h, useState } = React;

function openLink(url) {
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
    else window.open(url, '_blank', 'noopener');
}

/**
 * Send a coating to the project for the built-in library. With one of the
 * user's saved coatings selected, the GitHub issue and the email open
 * prefilled with its layer table and design conditions, and the coating can
 * be written as one file to attach. With nothing selected, the dialog only
 * points at the two ways to send a design.
 */
export function ShareDialog({ entry, c, t, onClose }) {
    const ts = t.coatingLibrary.share;
    const [status, setStatus] = useState('');

    async function pack() {
        const result = await packCoating(entry);
        if (result?.success) setStatus(ts.packed(result.filePath));
        else if (!result?.canceled) setStatus(ts.packFailed(result?.error || '?'));
    }

    const paragraph = text => h('p', { style: { margin: '0 0 12px', lineHeight: 1.5 } }, text);

    return h('div', {
        style: {
            position: 'fixed', inset: 0, zIndex: 1100, display: 'flex',
            alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.68)',
        },
    }, h('div', {
        style: {
            width: 520, maxWidth: '92vw', maxHeight: '86vh', overflow: 'auto',
            padding: 20, borderRadius: 8, border: `1px solid ${c.border}`,
            background: c.panel, color: c.text, boxShadow: '0 12px 42px rgba(0,0,0,.35)',
            fontFamily: FONT, fontSize: 12,
        },
    },
        h('h2', { style: { margin: '0 0 14px', fontSize: 17 } }, ts.title),
        paragraph(ts.intro),
        entry && h('div', { style: { marginBottom: 12 } },
            h('div', { style: { fontWeight: 600, marginBottom: 6 } }, ts.forEntry(entry.name)),
            h('pre', {
                style: {
                    margin: 0, padding: 8, maxHeight: 180, overflow: 'auto', fontSize: 11, lineHeight: 1.4,
                    background: c.bg, border: `1px solid ${c.border}`, borderRadius: 4, whiteSpace: 'pre-wrap',
                },
            }, `${layerTable(entry)}\n\n${conditionsText(entry)}`)),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('button', { onClick: () => openLink(issueUrl(entry)), style: buttonStyle(c, { primary: true }) }, ts.issue),
            h('button', { onClick: () => openLink(mailUrl(entry)), style: buttonStyle(c) }, ts.email(CONTRIBUTE_EMAIL)),
            entry && h('button', { onClick: pack, title: ts.packTip, style: buttonStyle(c) }, ts.pack)),
        entry && h('div', { style: { color: c.textDim, marginTop: 10, lineHeight: 1.45 } }, ts.fileHint),
        status && h('div', { role: 'status', style: { marginTop: 10, color: c.textDim, fontStyle: 'italic' } }, status),
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 18 } },
            h('button', { onClick: onClose, style: buttonStyle(c) }, ts.close)),
    ));
}
