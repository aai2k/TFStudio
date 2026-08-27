/**
 * EnvironmentEditor - Multi-environment optimization UI component.
 * 
 * Allows users to define multiple incident/emergent media environments
 * for joint optimization. Each environment has its own media settings
 * and weight.
 */

const { createElement: h } = React;

/**
 * Environment editor component for multi-environment optimization.
 * Displays a list of environments with media selectors and weights.
 *
 * Each row also exposes per-environment operand editing (breadcrumb
 * navigation): "Edit operands" switches the merit table's operand source to
 * this environment; an environment without its own operands shows a
 * "Uses design-level merit function" tag plus a "Customize" button that
 * materializes a private copy (with regenerated operand ids).
 */
export function EnvironmentEditor({ design, updateDesign, t, c, perEnvMf, activeEnvIndex, onEditOperands, onCustomize }) {
    const environments = design.meritEnvironments || [];
    const te = t.meritFunctionEditor || {};

    const addEnvironment = () => {
        const newEnv = {
            id: `env-${Date.now()}`,
            incidentMedium: design.incidentMedium || 'Air',
            exitMedium: design.exitMedium || 'Air',
            substrate: { ...(design.substrate || { material: 'BK7', thickness: 1.0 }) },
            weight: 1.0
        };
        updateDesign({ meritEnvironments: [...environments, newEnv] });
    };

    const removeEnvironment = (envId) => {
        updateDesign({
            meritEnvironments: environments.filter(e => e.id !== envId)
        });
    };

    const updateEnvironment = (envId, patch) => {
        updateDesign({
            meritEnvironments: environments.map(e =>
                e.id === envId ? { ...e, ...patch } : e
            )
        });
    };

    const containerStyle = {
        padding: '8px 12px',
        borderTop: `1px solid ${c.border}`,
        background: c.panel || '#f5f5f5',
        fontSize: 12,
    };

    const headerStyle = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
        fontWeight: 600,
    };

    const envRowStyle = {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 0',
        borderBottom: `1px solid ${c.border}20`,
    };

    const inputStyle = {
        padding: '2px 6px',
        border: `1px solid ${c.border}`,
        borderRadius: 3,
        background: c.bg || '#fff',
        color: c.text,
        fontSize: 11,
        width: 80,
    };

    const weightInputStyle = {
        ...inputStyle,
        width: 50,
    };

    const buttonStyle = {
        padding: '3px 8px',
        border: `1px solid ${c.border}`,
        borderRadius: 3,
        background: c.bg || '#fff',
        color: c.text,
        fontSize: 11,
        cursor: 'pointer',
    };

    const removeButtonStyle = {
        ...buttonStyle,
        color: '#c00',
        borderColor: '#c00',
    };

    const activeRowStyle = {
        ...envRowStyle,
        background: `${c.accent || '#0a84ff'}14`,
        borderRadius: 3,
    };

    const mfValueStyle = {
        fontSize: 11,
        fontFamily: 'monospace',
        color: c.text,
        minWidth: 55,
        textAlign: 'right',
    };

    const tagStyle = {
        fontSize: 10,
        padding: '1px 5px',
        borderRadius: 3,
        background: (c.border || '#ccc') + '40',
        color: c.textDim,
        whiteSpace: 'nowrap',
    };

    return h('div', { style: containerStyle },
        h('div', { style: headerStyle },
            h('span', null, te.environments || 'Environments'),
            h('button', {
                style: buttonStyle,
                onClick: addEnvironment,
                title: te.addEnvironment || 'Add environment'
            }, '+ ' + (te.add || 'Add'))
        ),
        environments.length === 0
            ? h('div', { style: { color: c.textDim, fontStyle: 'italic', padding: '4px 0' } },
                te.noEnvironments || 'No environments defined. Click "Add" to create one.')
            : environments.map((env, idx) =>
                h('div', { key: env.id, style: { borderBottom: `1px solid ${c.border}20` } },
                    h('div', {
                        style: activeEnvIndex === idx ? activeRowStyle : envRowStyle
                    },
                        h('span', { style: { width: 20, color: c.textDim } }, `E${idx + 1}`),
                        h('label', { style: { fontSize: 11 } }, te.incident || 'Incident:'),
                        h('input', {
                            style: inputStyle,
                            value: env.incidentMedium || '',
                            onChange: (e) => updateEnvironment(env.id, { incidentMedium: e.target.value }),
                            placeholder: 'Air'
                        }),
                        h('label', { style: { fontSize: 11 } }, te.exit || 'Exit:'),
                        h('input', {
                            style: inputStyle,
                            value: env.exitMedium || '',
                            onChange: (e) => updateEnvironment(env.id, { exitMedium: e.target.value }),
                            placeholder: 'Air'
                        }),
                        h('label', { style: { fontSize: 11 } }, te.substrate || 'Substrate:'),
                        h('input', {
                            style: inputStyle,
                            value: env.substrate?.material || '',
                            onChange: (e) => updateEnvironment(env.id, {
                                substrate: { ...env.substrate, material: e.target.value }
                            }),
                            placeholder: 'BK7'
                        }),
                        h('label', { style: { fontSize: 11 } }, te.weight || 'Weight:'),
                        h('input', {
                            style: weightInputStyle,
                            type: 'number',
                            min: 0,
                            step: 0.1,
                            value: env.weight ?? 1.0,
                            onChange: (e) => updateEnvironment(env.id, { weight: parseFloat(e.target.value) || 0 }),
                        }),
                        perEnvMf && perEnvMf[idx] != null
                            ? h('span', { style: mfValueStyle }, (te.mfLabel || 'MF:') + ' ' + perEnvMf[idx].toFixed(4))
                            : null,
                        env.operands
                            ? h('button', {
                                style: activeEnvIndex === idx ? { ...buttonStyle, background: c.accent || '#4a9', color: c.accentText || '#fff', borderColor: c.accent || '#4a9' } : buttonStyle,
                                onClick: () => onEditOperands(idx),
                                title: te.editOperandsTip || 'Edit the operand table for this environment'
                            }, te.editOperands || 'Edit')
                            : h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
                                h('span', { style: tagStyle }, te.usingDesignMf || 'Using design-level MF'),
                                h('button', {
                                    style: buttonStyle,
                                    onClick: () => onCustomize(idx),
                                    title: te.customizeOperandsTip || 'Create an independent operand set for this environment'
                                }, te.customizeOperands || 'Customize')
                            ),
                        h('button', {
                            style: removeButtonStyle,
                            onClick: () => removeEnvironment(env.id),
                            title: te.removeEnvironment || 'Remove environment'
                        }, '×')
                    )
                )
            )
    );
}

/**
 * Toggle component for enabling/disabling multi-environment mode.
 */
export function MultiEnvToggle({ design, updateDesign, t, c }) {
    const te = t.meritFunctionEditor || {};
    const isMultiEnv = (design.meritEnvironments || []).length > 0;

    const toggleMultiEnv = () => {
        if (isMultiEnv) {
            // Disable: clear environments
            updateDesign({ meritEnvironments: [] });
        } else {
            // Enable: create first environment from current design media
            const firstEnv = {
                id: `env-${Date.now()}`,
                incidentMedium: design.incidentMedium || 'Air',
                exitMedium: design.exitMedium || 'Air',
                substrate: { ...(design.substrate || { material: 'BK7', thickness: 1.0 }) },
                weight: 1.0
            };
            updateDesign({ meritEnvironments: [firstEnv] });
        }
    };

    const toggleStyle = {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 12px',
        fontSize: 11,
        cursor: 'pointer',
        userSelect: 'none',
    };

    const badgeStyle = {
        padding: '2px 6px',
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 600,
        background: isMultiEnv ? '#4a9' : c.border,
        color: isMultiEnv ? '#fff' : c.textDim,
    };

    return h('div', {
        style: toggleStyle,
        onClick: toggleMultiEnv,
        title: te.multiEnvToggle || 'Enable/disable multi-environment optimization'
    },
        h('input', {
            type: 'checkbox',
            checked: isMultiEnv,
            onChange: toggleMultiEnv,
            style: { cursor: 'pointer' }
        }),
        h('span', null, te.multiEnvironment || 'Multi-environment'),
        h('span', { style: badgeStyle }, isMultiEnv ? (te.on || 'ON') : (te.off || 'OFF'))
    );
}
