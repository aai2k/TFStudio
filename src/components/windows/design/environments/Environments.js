/**
 * Environments: the conditions one design is scored in, one column each.
 *
 * Environment 1 is the design itself. Each other environment sets only what
 * differs from it (the media, the substrate, a thickness factor or another
 * material for a layer material) and follows environment 1 in the rest. The
 * merit rows are scored in every environment that is on, or in the one their
 * Env cell names, and the MF a run minimizes is taken over all of them
 * (utils/environments/environmentMerit.js). Under the grid each environment's
 * own MF and its part of the total are read from the merit tables' values, so
 * they follow a run as the tables do.
 */
import { useDesign } from '../../../../state/DesignContext.js';
import { useLiveDesign } from '../../../../state/useLiveDesign.js';
import { tablerIcon } from '../../../ui/tablerIcons.js';
import { ActionButton } from '../../analysis/chrome/controls.js';
import { useMeritValues } from '../../optimization/useMeritValues.js';
import { DASH } from '../../optimization/meritFunctionEditor/mfTable/operandViewModel.js';
import { BASE_ENVIRONMENT, hasEnvironments } from '../../../../utils/environments/environments.js';
import { addEnvironment, removeEnvironment } from '../../../../utils/environments/environmentEdits.js';
import { useCurrentEnvironment } from './currentEnvironment.js';
import { copiedFields, environmentPatch, fieldEdit } from './environmentFields.js';
import { environmentMerits, meritFormula } from './environmentMerits.js';
import { EnvironmentGrid } from './EnvironmentGrid.js';

const { createElement: h, useMemo } = React;

const EMPTY = [];

// A new environment at the end of the list, holding `fields`, made current.
function addOne(ctx, fields) {
    const next = addEnvironment(ctx.design, fields);
    ctx.updateDesign(environmentPatch(ctx.design, next));
    ctx.current.select(next.environments[next.environments.length - 1].id);
}

// The current environment and its rows go, in one change; environment 1 is
// current after it.
function deleteCurrent(ctx) {
    const next = removeEnvironment(ctx.design, ctx.current.id);
    ctx.updateDesign(environmentPatch(ctx.design, next));
    ctx.current.select(BASE_ENVIRONMENT);
}

/**
 * Add, Duplicate (of the current environment) and Delete (of the current
 * environment, not environment 1), each one change to the design and so one
 * undo step. `ctx` is the window's: the design, updateDesign, the current
 * environment (useCurrentEnvironment), c and t.
 */
export function EnvironmentBar({ ctx }) {
    const { design, current, c, t } = ctx;
    const te = t.environments;
    const iconLabel = (icon, text) => h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } }, tablerIcon(icon, 12), text);
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', flexWrap: 'wrap',
            borderBottom: `1px solid ${c.border}`, background: c.panel, flexShrink: 0,
        },
    },
        h(ActionButton, { c, title: te.addTip, onClick: () => addOne(ctx, {}) }, iconLabel('plus', te.add)),
        h(ActionButton, {
            c, title: te.duplicateTip(current.number),
            onClick: () => addOne(ctx, copiedFields(design, current.id, t.explorer.duplicateName)),
        }, iconLabel('copy-plus', te.duplicate)),
        h(ActionButton, {
            c, title: te.deleteTip(current.number), disabled: current.id === BASE_ENVIRONMENT,
            onClick: () => deleteCurrent(ctx),
        }, iconLabel('trash', te.delete)),
        h('span', { style: { fontSize: 11, color: c.textDim, marginLeft: 8 } }, ctx.many ? te.hint : te.hintOne));
}

// The MF over every environment that is on, and how it is made up.
function MeritTotal({ values, merits, c, t }) {
    const formula = meritFormula(merits);
    return h('div', {
        title: t.environments.totalTip,
        style: {
            padding: '6px 10px', borderTop: `1px solid ${c.border}`, background: c.panel, flexShrink: 0,
            fontSize: 11, color: c.textDim, fontVariantNumeric: 'tabular-nums',
        },
    },
        t.meritFunctionEditor.mfLabel + ' ',
        h('b', { style: { color: c.text } }, values.mf == null ? DASH : values.mf.toFixed(6)),
        formula && ` = ${formula}`);
}

export function Environments({ c, t }) {
    const { design, updateDesign } = useDesign();
    const current = useCurrentEnvironment(design);
    const operands = design.meritOperands || EMPTY;
    // Read from the sampled design, so the merit follows a run at the live
    // preview's cadence, as the merit tables do.
    const { design: liveDesign, preview } = useLiveDesign();
    const values = useMeritValues(liveDesign, operands, preview);
    const merits = useMemo(() => environmentMerits(design, operands, values), [design, operands, values]);
    const ctx = {
        design, updateDesign, current, c, t, many: hasEnvironments(design),
        edit: (id, field, value) => updateDesign(fieldEdit(design, id, field, value)),
    };
    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
            background: c.bg, color: c.text, fontFamily: 'system-ui, -apple-system, sans-serif',
        },
    },
        h(EnvironmentBar, { ctx }),
        h('div', { style: { flex: 1, minHeight: 0, overflow: 'auto' } }, h(EnvironmentGrid, { ctx, merits })),
        h(MeritTotal, { values, merits, c, t }));
}
