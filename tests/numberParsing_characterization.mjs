// Characterization test for numberParsing.js — locks current output of
// parseNumber / isValidNumberInput / hasInvalidSymbols so an internal
// refactor (many-returns cleanup) cannot change behavior.
// Run: node tests/numberParsing_characterization.mjs
import { parseNumber, isValidNumberInput, hasInvalidSymbols } from '../src/utils/misc/numberParsing.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

// ── parseNumber: separator normalization + scientific notation ──────────────
ok('parseNumber "1.5"', parseNumber('1.5') === 1.5);
ok('parseNumber "1,5"', parseNumber('1,5') === 1.5);
ok('parseNumber "1.2e-3"', parseNumber('1.2e-3') === 0.0012);
ok('parseNumber "1.2E-3"', parseNumber('1.2E-3') === 0.0012);
ok('parseNumber "1,2e-3"', parseNumber('1,2e-3') === 0.0012);
ok('parseNumber "-3.14"', parseNumber('-3.14') === -3.14);
ok('parseNumber "-3,14"', parseNumber('-3,14') === -3.14);
ok('parseNumber EU "1.000,5"', parseNumber('1.000,5') === 1000.5);
ok('parseNumber US "1,000.5"', parseNumber('1,000.5') === 1000.5);
ok('parseNumber ""', parseNumber('') === 0);
ok('parseNumber whitespace', parseNumber('   ') === 0);
ok('parseNumber already-number', parseNumber(42) === 42);
ok('parseNumber null', parseNumber(null) === 0);
ok('parseNumber undefined', parseNumber(undefined) === 0);
ok('parseNumber object', parseNumber({}) === 0);

// ── isValidNumberInput: partial-typing states must stay valid ───────────────
ok('isValidNumberInput "-"', isValidNumberInput('-') === true);
ok('isValidNumberInput "+"', isValidNumberInput('+') === true);
ok('isValidNumberInput "."', isValidNumberInput('.') === true);
ok('isValidNumberInput ","', isValidNumberInput(',') === true);
ok('isValidNumberInput "1."', isValidNumberInput('1.') === true);
ok('isValidNumberInput "1,"', isValidNumberInput('1,') === true);
ok('isValidNumberInput "1e"', isValidNumberInput('1e') === true);
ok('isValidNumberInput "1E"', isValidNumberInput('1E') === true);
ok('isValidNumberInput "1e-"', isValidNumberInput('1e-') === true);
ok('isValidNumberInput "1.2e"', isValidNumberInput('1.2e') === true);
ok('isValidNumberInput "1.5"', isValidNumberInput('1.5') === true);
ok('isValidNumberInput "abc"', isValidNumberInput('abc') === false);
// Multiple dots collapse to thousands-grouping in parseNumber, so this
// parses to a finite number and is currently accepted.
ok('isValidNumberInput "1.2.3"', isValidNumberInput('1.2.3') === true);
ok('isValidNumberInput ""', isValidNumberInput('') === false);
ok('isValidNumberInput whitespace', isValidNumberInput('   ') === false);
ok('isValidNumberInput "1e-3"', isValidNumberInput('1e-3') === true);
ok('isValidNumberInput "-3.14"', isValidNumberInput('-3.14') === true);
ok('isValidNumberInput non-string', isValidNumberInput(42) === false);

// ── hasInvalidSymbols ─────────────────────────────────────────────────────────
ok('hasInvalidSymbols "1.5"', hasInvalidSymbols('1.5') === false);
ok('hasInvalidSymbols "1,5abc"', hasInvalidSymbols('1,5abc') === true);
ok('hasInvalidSymbols "1.2e-3"', hasInvalidSymbols('1.2e-3') === false);
ok('hasInvalidSymbols "hello"', hasInvalidSymbols('hello') === true);
ok('hasInvalidSymbols "1 2"', hasInvalidSymbols('1 2') === false);
ok('hasInvalidSymbols ""', hasInvalidSymbols('') === false);
ok('hasInvalidSymbols null', hasInvalidSymbols(null) === false);

if (fail === 0) console.log(`PASS: numberParsing_characterization (${pass} checks)`);
else { console.error(`\n${fail} test(s) failed, ${pass} passed.`); process.exit(1); }
