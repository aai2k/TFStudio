/**
 * The Environments grid: one column per environment, environment 1 first,
 * and a row per field the environments can set, grouped under Media, Cone,
 * back side and temperature, and Layers, then the merit of each environment
 * under Merit.
 */
import { environmentsOf } from '../../../../utils/environments/environments.js';
import { designMaterialShortName } from '../../../../utils/materials/designMaterials.js';
import { DASH, fmtContribution } from '../../optimization/meritFunctionEditor/mfTable/operandViewModel.js';
import { CONE_DEFAULT } from '../designEditor/ConeAngleControl.js';
import { CONDITION_FIELDS, MEDIA_FIELDS, layerMaterials, missingConstants } from './environmentFields.js';
import { FieldCell, HeadCell, currentTint } from './EnvironmentCells.js';

const { createElement: h } = React;

// The label column and the least an environment's column narrows to, px.
const LABEL_W = 164;
const COLUMN_W = 132;

const MEDIA_KINDS = { incidentMedium: 'material', substrateMaterial: 'material', substrateThickness: 'thickness', exitMedium: 'material' };
const CONDITION_KINDS = { cone: 'cone', mfEvalMode: 'backSide', temperatureC: 'temperature' };

// The materials an environment computes with at its temperature that lack a
// constant of the model, by name, with each one's missing constants on hover.
function ConstantsCell({ ctx, env }) {
    const { design, c, t } = ctx;
    const lacking = missingConstants(design, env.id);
    if (!lacking?.length) return null;
    const label = name => t.materialEditor.mechanicalFields[name];
    const names = lacking.map(({ id }) => designMaterialShortName(design, id));
    return h('div', {
        title: `${t.environments.constantsMissingTip}\n\n${lacking.map(({ missing }, k) => `${names[k]}: ${missing.map(label).join(', ')}`).join('\n')}`,
        style: { fontSize: 11, color: c.warning || '#ef9800', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 5px' },
    }, names.join(', '));
}

// The rows of the cone, the back side and the temperature, and under the
// temperature the materials lacking a constant of its model.
function conditionRows(te) {
    const labels = { cone: te.cone, mfEvalMode: te.backSide, temperatureC: te.temperature };
    return [
        ...CONDITION_FIELDS.map(field => ({
            key: field.key, field, kind: CONDITION_KINDS[field.key], label: labels[field.key],
            // A click on environment 1's cone copies it as the control shows it.
            ...(field.key === 'cone' ? { copy: value => ({ ...CONE_DEFAULT, ...value }) } : {}),
        })),
        { key: 'constants', label: te.constantsMissing, cell: ConstantsCell },
    ];
}

// The field rows, grouped: the media and the substrate, the cone, the back
// side and the temperature, then a thickness factor and a material in place
// for each layer material.
function fieldGroups(design, t) {
    const de = t.designEditor;
    const te = t.environments;
    const labels = {
        incidentMedium: de.incidentMedium, substrateMaterial: de.substrate,
        substrateThickness: te.substrateThickness, exitMedium: de.exitMedium,
    };
    const media = MEDIA_FIELDS.map(field => ({ key: field.key, field, kind: MEDIA_KINDS[field.key], label: labels[field.key] }));
    const materials = layerMaterials(design);
    const name = id => designMaterialShortName(design, id);
    const layers = [
        ...materials.map(material => ({
            key: `factor:${material}`, field: { key: 'factor', material }, kind: 'factor', label: te.factorOf(name(material)),
        })),
        ...materials.map(material => ({
            key: `swap:${material}`, field: { key: 'swap', material }, kind: 'material', label: te.swapOf(name(material)),
        })),
    ];
    return [
        { key: 'media', title: te.media, rows: media },
        { key: 'conditions', title: te.conditions, rows: conditionRows(te) },
        { key: 'layers', title: te.layers, rows: layers },
    ];
}

// What each environment's merit cells read (environmentMerits.js).
function meritRows(te) {
    return [
        { key: 'rows', label: te.rowsScored, text: merit => String(merit.rows) },
        { key: 'mf', label: te.meritOf, text: merit => (!merit.on ? te.off : merit.mf == null ? DASH : merit.mf.toFixed(6)) },
        { key: 'part', label: te.partOf, text: merit => (merit.part == null ? '' : fmtContribution(merit.part)) },
    ];
}

export function EnvironmentGrid({ ctx, merits }) {
    const { design, current, c, t } = ctx;
    const te = t.environments;
    const list = environmentsOf(design);
    const line = `1px solid ${c.border}`;
    const cellStyle = env => ({
        padding: '3px 5px', height: 29, overflow: 'hidden', borderLeft: line, borderBottom: line,
        background: env.id === current.id ? currentTint(c) : 'transparent',
    });
    const label = text => h('th', {
        scope: 'row', title: text,
        style: {
            textAlign: 'left', fontWeight: 400, color: c.text, padding: '0 6px 0 10px', borderBottom: line,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        },
    }, text);
    const heading = (key, title) => h('tr', { key: `group-${key}` }, h('td', {
        colSpan: list.length + 1,
        style: {
            padding: '6px 10px 3px', fontSize: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase',
            color: c.textDim, background: c.bg, borderBottom: line,
        },
    }, title));
    const fieldRow = row => h('tr', { key: row.key }, label(row.label),
        list.map(env => h('td', { key: env.id, style: cellStyle(env) }, h(row.cell || FieldCell, { ctx, env, row }))));
    const meritRow = row => h('tr', { key: `merit-${row.key}` }, label(row.label),
        list.map((env, index) => h('td', {
            key: env.id, style: { ...cellStyle(env), paddingLeft: 11, fontVariantNumeric: 'tabular-nums', color: merits[index].on ? c.text : c.textDim },
        }, row.text(merits[index]))));
    return h('table', {
        style: {
            borderCollapse: 'collapse', tableLayout: 'fixed', width: '100%', minWidth: LABEL_W + list.length * COLUMN_W,
            fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif', color: c.text,
        },
    },
        h('colgroup', null, h('col', { style: { width: LABEL_W } }), list.map(env => h('col', { key: env.id }))),
        h('thead', null, h('tr', null,
            h('th', {
                style: {
                    textAlign: 'left', verticalAlign: 'bottom', padding: '4px 10px', fontSize: 10, fontWeight: 600,
                    color: c.textDim, background: c.panel, borderBottom: line,
                },
            }, te.environment),
            list.map((env, index) => h(HeadCell, { key: env.id, ctx, env, index })))),
        h('tbody', null,
            fieldGroups(design, t).filter(group => group.rows.length > 0)
                .flatMap(group => [heading(group.key, group.title), ...group.rows.map(fieldRow)]),
            heading('merit', te.merit),
            meritRows(te).map(meritRow)),
    );
}
