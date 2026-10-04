/**
 * A dropdown shows its chosen label on one line however narrow it is
 * (src/styles.css, the base-select block). A long curve name in the merit
 * function wizard wrapped onto a second line inside a one-line box.
 *
 * base-select puts the label in an anonymous box no selector reaches, so the
 * rule that keeps it to one line is on the select itself: no wrapping, nothing
 * past the box, and a grid whose label column may shrink below the label while
 * the chevron keeps its own column, painted in the field colour so the cut
 * text does not show through it. Checked against the stylesheet's own text.
 *
 * Run: node tests/select_one_line.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const block = css.slice(css.indexOf('@supports (appearance: base-select)'));
assert.ok(block.length > 0, 'the base-select block is there');

// The declarations of the first rule in the block whose selector is exactly `selector`.
function rule(selector) {
    const pattern = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
    const found = pattern.exec(block);
    assert.ok(found, `no rule for ${selector}`);
    return Object.fromEntries(found[2].replace(/\/\*[\s\S]*?\*\//g, '').split(';')
        .map(part => part.trim()).filter(Boolean)
        .map(part => [part.slice(0, part.indexOf(':')).trim(), part.slice(part.indexOf(':') + 1).trim()]));
}

const select = rule('select');
assert.equal(select['white-space'], 'nowrap', 'the label never wraps');
assert.equal(select.overflow, 'hidden', 'and nothing shows past the box');
assert.equal(select.display, 'inline-grid', 'a grid, so the label column can shrink');
assert.match(select['grid-template-columns'] || '', /^minmax\(0,\s*1fr\)\s+\d+px$/, 'label column with no minimum, then the chevron');

const icon = rule('select::picker-icon');
assert.equal(icon['background-color'], 'inherit', 'the chevron sits on the field colour over the cut label');
assert.match(icon.width || '', /^\d+px$/);

console.log('PASS: select_one_line');
