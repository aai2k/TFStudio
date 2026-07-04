// InputDialog component - text input dialog (rename/new folder) and confirm dialog (yes/no)
//
// Confirm mode: set inputDialog.confirm = true — hides the text input, shows message + buttons.
// Text input mode: default — validates and confirms a text value.

const { createElement: h } = React;

const BACKDROP = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10001
};

const MODAL_BASE = (c) => ({
    backgroundColor: c.panel, border: `1px solid ${c.border}`,
    borderRadius: 8, padding: 20, minWidth: 360, maxWidth: 480,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    fontFamily: 'system-ui, -apple-system, sans-serif'
});

const TITLE_STYLE = (c) => ({
    margin: '0 0 12px 0', color: c.text, fontSize: 16, fontWeight: 500
});

const BTN_BASE = {
    padding: '8px 18px', border: 'none', borderRadius: 4,
    cursor: 'pointer', fontSize: 13
};

export const InputDialog = ({ inputDialog, c, t }) => {
    // Hooks must run unconditionally with a constant count/order on every render.
    // This dialog switches between confirm mode (no text input) and text mode
    // within ONE mounted instance, so hooks cannot sit after the early returns
    // below — that caused React's "Expected static flag was missing" hook-order
    // error when transitioning between modes.
    const [value, setValue] = React.useState('');
    const [error, setError] = React.useState('');

    // Reset the field whenever a NEW text dialog opens (inputDialog identity
    // changes), so each open starts at its defaultValue.
    React.useEffect(() => {
        if (inputDialog && !inputDialog.confirm) {
            const dv = inputDialog.defaultValue || '';
            setValue(dv);
            setError(inputDialog.validate ? (inputDialog.validate(dv) || '') : '');
        }
    }, [inputDialog]);

    // Live validation as the user types.
    React.useEffect(() => {
        if (inputDialog && !inputDialog.confirm) {
            setError(inputDialog.validate ? (inputDialog.validate(value) || '') : '');
        }
    }, [value, inputDialog]);

    if (!inputDialog) return null;

    // ── Confirm mode (yes / no — no text input) ───────────────────────────────
    if (inputDialog.confirm) {
        const danger = inputDialog.danger !== false; // default to danger style for deletions
        return h('div', {
            style: BACKDROP,
            onClick: () => inputDialog.onCancel()
        },
            h('div', {
                style: MODAL_BASE(c),
                onClick: (e) => e.stopPropagation()
            },
                h('h3', { style: TITLE_STYLE(c) }, inputDialog.title),
                inputDialog.message && h('p', {
                    style: { margin: '0 0 20px 0', color: c.textDim, fontSize: 13, lineHeight: 1.5 }
                }, inputDialog.message),
                h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
                    h('button', {
                        onClick: () => inputDialog.onCancel(),
                        autoFocus: true,
                        style: {
                            ...BTN_BASE, backgroundColor: c.panel, color: c.text,
                            border: `1px solid ${c.border}`
                        }
                    }, t.dialogs.input.cancel),
                    h('button', {
                        onClick: () => inputDialog.onConfirm(),
                        style: {
                            ...BTN_BASE,
                            backgroundColor: danger ? '#c0392b' : c.accent,
                            color: '#fff'
                        }
                    }, inputDialog.confirmLabel || t.dialogs.input.ok)
                )
            )
        );
    }

    // ── Text input mode (rename / new folder) ─────────────────────────────────
    const isValid = !error && value.trim().length > 0;

    return h('div', {
        style: BACKDROP,
        onClick: () => inputDialog.onCancel()
    },
        h('div', {
            style: MODAL_BASE(c),
            onClick: (e) => e.stopPropagation()
        },
            h('h3', { style: TITLE_STYLE(c) }, inputDialog.title),
            h('input', {
                type: 'text', value, autoFocus: true,
                onChange: (e) => setValue(e.target.value),
                onKeyDown: (e) => {
                    if (e.key === 'Enter' && isValid) inputDialog.onConfirm(value);
                    else if (e.key === 'Escape') inputDialog.onCancel();
                },
                style: {
                    width: '100%', padding: '8px 12px', boxSizing: 'border-box',
                    backgroundColor: c.bg, color: c.text,
                    border: `1px solid ${error ? '#e94560' : c.border}`,
                    borderRadius: 4, fontSize: 14, outline: 'none'
                }
            }),
            error && h('div', { style: { color: '#e94560', fontSize: 12, marginTop: 8 } }, error),
            h('div', { style: { display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' } },
                h('button', {
                    onClick: () => inputDialog.onCancel(),
                    style: { ...BTN_BASE, backgroundColor: c.panel, color: c.text, border: `1px solid ${c.border}` }
                }, t.dialogs.input.cancel),
                h('button', {
                    onClick: () => { if (isValid) inputDialog.onConfirm(value); },
                    disabled: !isValid,
                    style: {
                        ...BTN_BASE,
                        backgroundColor: isValid ? c.accent : c.border,
                        color: isValid ? '#fff' : c.textDim,
                        cursor: isValid ? 'pointer' : 'not-allowed',
                        opacity: isValid ? 1 : 0.5
                    }
                }, t.dialogs.input.ok)
            )
        )
    );
};
