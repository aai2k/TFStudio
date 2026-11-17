/**
 * Russian names the merit function one way, as the Merit Function Editor's
 * title does: функция качества. No string calls it оценочная функция or
 * целевая функция.
 *
 * Run: node tests/ru_merit_function_term.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { getLocale } = await import('../src/constants/locales/index.js');
assert.equal(getLocale('ru').meritFunctionEditor.title, 'Редактор функции качества');

const source = readFileSync(new URL('../src/constants/locales/ru.js', import.meta.url), 'utf-8');
const other = source.split('\n')
    .map((line, i) => `${i + 1}: ${line.trim()}`)
    .filter(line => /(оценочн|целев)\S*\s+функц/i.test(line));
assert.deepEqual(other, [], 'a Russian string names the merit function another way');

console.log('ru_merit_function_term passed.');
