import { EvalModeBadge } from '../../../SurfaceModeBar.js';
import { checksWithoutRow } from '../../../../utils/synthesis/qualifiers.js';
import { btnStyle } from './fields.js';

const { createElement: h } = React;

// The checks Generate MF leaves out of the merit function it writes, named
// beside the button so a passing merit is not read as every check met.
function NoRowNote({ qualifiers, design, c, ts }) {
    const left = checksWithoutRow(qualifiers, { design });
    if (left.length === 0) return null;
    const names = left.map(q => q.label || (ts.kinds && ts.kinds[q.kind]) || q.kind);
    return h('div', { style: { fontSize: 11, color: c.warning || c.textDim } }, ts.noMFRow(names));
}

export function VerdictBar({ verdict, c, ts, qualifiers, generateMF, design, t }) {
    const { passing, total, allPass } = verdict;
    const color = total === 0 ? c.textDim
                : allPass     ? c.success
                              : c.error;
    const label = total === 0 ? (ts.noActive || 'No active qualifiers')
                : allPass     ? (ts.allPass  || 'All requirements pass')
                              : (ts.someFail || `${total - passing} requirement(s) failing`);

    return h('div', {
        style: {
            padding: '8px 12px', background: c.panel,
            borderBottom: `1px solid ${c.border}`,
            display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }
    },
        h('div', {
            style: {
                fontSize: 12, fontWeight: 700, color,
                padding: '4px 10px', borderRadius: 12,
                background: `${color}1a`, border: `1px solid ${color}55`,
            }
        }, label),
        total > 0 && h('div', { style: { fontSize: 11, color: c.textDim } },
            `${passing}/${total} ${ts.passingSuffix || 'passing'}`),
        // Read-only reminder of what qualifiers are scored against
        // (set in the Design Editor).
        design && h(EvalModeBadge, { design, c, t, style: { marginLeft: 12 } }),
        h('div', { style: { flex: 1 } }),
        h(NoRowNote, { qualifiers, design, c, ts }),
        qualifiers.length > 0 && h('button', {
            onClick: generateMF,
            title: ts.generateMFTip || 'Convert qualifiers into MF operands (OPGT/OPLT) and write to the design',
            style: btnStyle(c),
        }, ts.generateMF || 'Generate MF')
    );
}
