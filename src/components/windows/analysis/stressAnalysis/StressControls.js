/**
 * The four numbers the stress calculation asks for, and everything the result
 * needs qualifying with.
 *
 * All four are design data, so they sit in the control row itself rather than
 * behind the settings gear: they are what the window computes from, not how it
 * draws. The gear holds nothing, so there is none.
 */

import { DEFAULT_STRESS_TEMPERATURE_C } from '../../../../utils/physics/stress/stackForce.js';
import { Divider, FieldLabel, NumInput } from '../chrome/controls.js';
import { ControlRow } from '../chrome/layout.js';
import { NoticeBadge } from '../chrome/popover.js';

const { createElement: h } = React;

// Wide enough for a four-figure deposition temperature and a 500 mm substrate.
const FIELD_WIDTH = 64;

function Field({ c, label, unit, ...input }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 5 } },
        h(FieldLabel, { c }, label),
        h(NumInput, { c, width: FIELD_WIDTH, ...input }),
        unit && h(FieldLabel, { c }, unit),
    );
}

export function StressControls({ c, t, sa, state, notices }) {
    // Until the design carries a stress block there is no run at all; once it
    // does, a temperature left out of it reads as 20 °C, and the placeholder
    // says which of the two is the case.
    const temperaturePlaceholder = state.hasRun ? String(DEFAULT_STRESS_TEMPERATURE_C) : sa.unset;
    return h(ControlRow, {
        c,
        trailing: [h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices })],
    },
        h(Field, {
            c, label: sa.temperature, unit: '°C', nullable: true,
            placeholder: temperaturePlaceholder, title: sa.temperatureTip,
            value: state.temperatureC, min: -273, max: 5000, step: 5,
            onChange: state.setTemperatureC,
        }),
        h(Field, {
            c, label: sa.depositionTemperature, unit: '°C', nullable: true,
            placeholder: temperaturePlaceholder, title: sa.depositionTemperatureTip,
            value: state.depositionTemperatureC, min: -273, max: 5000, step: 5,
            onChange: state.setDepositionTemperatureC,
        }),
        h(Divider, { c }),
        h(Field, {
            c, label: sa.substrateThickness, unit: 'mm', title: sa.substrateThicknessTip,
            value: state.thicknessMm, min: 0.01, max: 1000, step: 0.5,
            onChange: state.setThicknessMm,
        }),
        h(Field, {
            c, label: sa.substrateDiameter, unit: 'mm', nullable: true,
            placeholder: sa.unset, title: sa.substrateDiameterTip,
            value: state.diameterMm, min: 0.1, max: 2000, step: 5, emptyStep: 25,
            onChange: state.setDiameterMm,
        }),
    );
}

// One line per material, naming the constants it leaves out under the names
// the Material Editor gives them.
function missingDetail(missing, fieldNames) {
    return missing
        .map(entry => `${entry.name}: ${entry.fields.map(field => fieldNames[field] || field).join(', ')}`)
        .join('\n');
}

/**
 * What has to be said about the numbers before they are read: the constants
 * nobody entered, the deflection nobody can compute, and the two cases where a
 * row is blank or zero for a reason rather than by accident.
 */
export function stressNotices(result, t) {
    const sa = t.stressAnalysis;
    const notices = [];
    if (!result) return notices;
    if (!result.run) notices.push({ label: sa.noticeNoRun, tone: 'info' });
    if (result.missing.length) {
        notices.push({
            label: sa.noticeMissing(result.missing.length),
            detail: missingDetail(result.missing, t.materialEditor.mechanicalFields),
        });
    }
    if (result.substrate.radiusM == null) notices.push({ label: sa.noticeNoDiameter });
    // Balanced, not merely unknown: a stack where no material states a stress
    // also sums to exactly zero, and that is the missing-constants notice's
    // story rather than this one's.
    const statesStress = result.rows.some(row => row.stressMPa != null);
    if (result.bothSides && statesStress && result.whole.forceNm === 0) {
        notices.push({ label: sa.noticeBalanced, tone: 'info' });
    }
    return notices;
}
