/**
 * multi_env_i18n.mjs — Multi-environment editor i18n coverage.
 *
 * The EnvironmentEditor / MultiEnvToggle components read
 * `t.meritFunctionEditor.<key>` with an English fallback. This test pins the
 * keys that must exist in the EN and ZH language packs so the UI is actually
 * localized (not silently falling back to English).
 */

import assert from 'node:assert';
import { getLocale } from '../src/constants/locales.js';

const KEYS = [
    'environments',
    'addEnvironment',
    'noEnvironments',
    'incident',
    'exit',
    'substrate',
    'weight',
    'removeEnvironment',
    'multiEnvironment',
    'multiEnvToggle',
    'on',
    'off',
];

// EN values must match the English meaning (the component's fallback strings).
const EN_EXPECTED = {
    environments: 'Environments',
    addEnvironment: 'Add environment',
    noEnvironments: 'No environments defined. Click "Add" to create one.',
    incident: 'Incident:',
    exit: 'Exit:',
    substrate: 'Substrate:',
    weight: 'Weight:',
    removeEnvironment: 'Remove environment',
    multiEnvironment: 'Multi-environment',
    multiEnvToggle: 'Enable/disable multi-environment optimization',
    on: 'ON',
    off: 'OFF',
};

// ZH values must be non-empty Chinese text.
const ZH_EXPECTED = {
    environments: '环境',
};

const en = getLocale('en').meritFunctionEditor || {};
const zh = getLocale('zh').meritFunctionEditor || {};

let failures = 0;
const check = (cond, msg) => {
    if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
};

console.log('multi_env_i18n: checking meritFunctionEditor keys in EN + ZH');

for (const key of KEYS) {
    check(key in en, `EN missing key "${key}"`);
    check(key in zh, `ZH missing key "${key}"`);
    if (key in en) {
        check(typeof en[key] === 'string' && en[key].trim() !== '',
            `EN "${key}" is empty`);
        if (key in EN_EXPECTED) {
            check(en[key] === EN_EXPECTED[key],
                `EN "${key}" = "${en[key]}", expected "${EN_EXPECTED[key]}"`);
        }
    }
    if (key in zh) {
        check(typeof zh[key] === 'string' && zh[key].trim() !== '',
            `ZH "${key}" is empty`);
        if (key in ZH_EXPECTED) {
            check(zh[key] === ZH_EXPECTED[key],
                `ZH "${key}" = "${zh[key]}", expected "${ZH_EXPECTED[key]}"`);
        }
    }
}

// Task 4: opticalEval namespace keys for the env selector/lock button.
const oeEn = getLocale('en').opticalEval || {};
const oeZh = getLocale('zh').opticalEval || {};
const OE_KEYS = ['environment', 'designLevel', 'lockView', 'unlockView', 'compareHint'];
for (const key of OE_KEYS) {
    check(key in oeEn, `EN opticalEval missing "${key}"`);
    check(key in oeZh, `ZH opticalEval missing "${key}"`);
    if (key in oeEn) check(typeof oeEn[key] === 'string' && oeEn[key].trim() !== '', `EN opticalEval "${key}" empty`);
    if (key in oeZh) check(typeof oeZh[key] === 'string' && oeZh[key].trim() !== '', `ZH opticalEval "${key}" empty`);
}

if (failures > 0) {
    console.error(`multi_env_i18n: FAIL (${failures} problem(s))`);
    process.exit(1);
}
console.log('multi_env_i18n: PASS — all 12 meritFunctionEditor + 5 opticalEval keys present and translated in EN + ZH');