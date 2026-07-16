import { SideSeg, FooterBtn } from './ui.js';

const { createElement: h } = React;

export function Footer({ state, c, sf, folderName, hasActiveDesign, onClose }) {
    const { compiled, isSym, applySide, setApplySide, newName, setNewName, applyToDesign } = state;
    return h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
               paddingTop: 12, borderTop: `1px solid ${c.border}`, marginTop: 12, gap: 12, flexWrap: 'wrap' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h('span', { style: { fontSize: 12, color: c.textDim } }, sf.applyToSide),
                h(SideSeg, { value: applySide, onChange: setApplySide, disabled: isSym, c, sf }),
                isSym && h('span', { style: { fontSize: 10.5, color: c.textDim, fontStyle: 'italic' } }, sf.symmetricNote),
            ),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.textDim } },
                h('span', {}, sf.newName),
                h('input', { type: 'text', value: newName, onChange: (e) => setNewName(e.target.value),
                    style: { width: 140, padding: '5px 8px', fontSize: 12, backgroundColor: c.bg, color: c.text,
                             border: `1px solid ${c.border}`, borderRadius: 4, outline: 'none' } }),
            ),
        ),
        h('div', { style: { display: 'flex', gap: 8 } },
            h(FooterBtn, { onClick: onClose, c }, sf.cancel),
            h(FooterBtn, { onClick: () => applyToDesign('append'), c,
                disabled: !compiled.ok || !hasActiveDesign,
                title: !hasActiveDesign ? sf.noActiveDesign : sf.appendTip }, sf.append),
            h(FooterBtn, { onClick: () => applyToDesign('replace'), c,
                disabled: !compiled.ok || !hasActiveDesign,
                title: !hasActiveDesign ? sf.noActiveDesign : sf.replaceTip }, sf.replace),
            h(FooterBtn, { onClick: () => applyToDesign('new'), c, primary: true,
                disabled: !compiled.ok || !folderName,
                title: !folderName ? sf.noFolder : sf.newTip }, sf.newDesign),
        )
    );
}
