/**
 * The Admittance Diagram's third polarization choice reads s+p in every
 * language. An admittance locus has no s and p average: the choice draws the
 * s and the p locus each (admittance_diagram_characterization.mjs pins the
 * two loci), so a label saying avg promised a curve the window does not draw.
 * Its stored value stays 'avg', so a saved window opens on it unchanged.
 *
 * Run: node tests/admittance_pol_label.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { getLocale } from '../src/constants/locales/index.js';

shimBrowserGlobals();
await loadApp();
const { AdmittanceControls } = await import('../src/components/windows/analysis/admittanceDiagram/AdmittanceControls.js');

const c = makeTheme();
const state = {
    view: 'admittance', pol: 'avg', side: 'front', sideOffered: { front: true, back: true },
    setView() {}, setPol() {}, setSide() {},
};
for (const code of ['en', 'ru', 'zh', 'it']) {
    const t = getLocale(code);
    const row = AdmittanceControls({ c, t, state, notices: [] });
    const choices = [].concat(row.props.children).filter(Boolean);
    const polarization = choices.find(choice => choice.props.ariaLabel === t.admittance.polarization);
    assert.ok(polarization, `${code}: the polarization choice is on the row`);
    assert.deepEqual(polarization.props.items.map(item => [item.id, item.label]), [['avg', 's+p'], ['s', 's'], ['p', 'p']],
        `${code}: s+p, s and p, the first stored as avg`);
}

console.log('PASS admittance_pol_label');
