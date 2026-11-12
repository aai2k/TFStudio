/**
 * The Environments grid: one column per environment, environment 1 first,
 * and a row per field the environments can set, grouped under Media and
 * Layers, then the merit of each environment under Merit.
 */
import { environmentsOf } from '../../../../utils/environments/environments.js';
import { designMaterialShortName } from '../../../../utils/materials/designMaterials.js';
import { DASH, fmtContribution } from '../../optimization/meritFunctionEditor/mfTable/operandViewModel.js';
import { MEDIA_FIELDS, layerMaterials } from './environmentFields.js';
import { FieldCell, HeadCell, currentTint } from './EnvironmentCells.js';

const { createElement: h } = React;

// The label column and the least an environment's column narrows to, px.
const LABEL_W = 164;
const COLUMN_W = 132;

const MEDIA_KINDS = { incidentMedium: 'material', substrateMaterial: 'material', substrateThickness: 'thickness', exitMedium: 'material' };

// The field rows, grouped: the media and the substrate, then a thickness
// factor and a material in place for each layer material.
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
    return [{ key: 'media', title: te.media, rows: media }, { key: 'layers', title: te.layers, rows: layers }];
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
        list.map(env => h('td', { key: env.id, style: cellStyle(env) }, h(FieldCell, { ctx, env, row }))));
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
