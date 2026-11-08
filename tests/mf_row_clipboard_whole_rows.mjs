/**
 * Merit rows survive copy and paste. A paste of rows copied from the table
 * gives back rows equal to the originals apart from their ids: a sloped
 * target keeps its end, a math row the rows it reads, a comment its text, an
 * integral its source, a STR row its comparison, and every target its full
 * precision. A math row copied with the row it reads reads that row's copy;
 * copied without it, it reads the original. Text from anywhere else is still
 * read field by field, and the text the table writes keeps full precision.
 *
 * Run: node tests/mf_row_clipboard_whole_rows.mjs
 */
import assert from 'node:assert/strict';

const MFE = '../src/components/windows/optimization/meritFunctionEditor';
const { addOperands, makeRowOperand } = await import(`${MFE}/meritOperandModel.js`);
const {
    copySelectedOperands, parseOperandsTsv, pasteOperands, serializeOperandsTsv,
} = await import(`${MFE}/mfTable/operandClipboard.js`);
const { pasteIntoCell } = await import(`${MFE}/mfTable/cellClipboard.js`);

const REF_KEYS = ['refId', 'refId1', 'refId2'];

// A clipboard that holds what was last written to it.
function memoryClipboard() {
    let text = '';
    return {
        writeText(value) { text = value; return Promise.resolve(); },
        readText: () => Promise.resolve(text),
        set(value) { text = value; },
        get text() { return text; },
    };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// The table after Ctrl+V of the clipboard below row `atIndex - 1`.
async function paste(clipboard, operands, atIndex) {
    let result = null;
    pasteOperands((items, at) => { result = addOperands(operands, items, at).operands; }, atIndex, clipboard);
    await settle();
    return result;
}

const tav = makeRowOperand({ type: 'TAV', lambdaStart: 500, lambdaEnd: 600, target: 0.333 });
const cons = makeRowOperand({ type: 'CONS', target: 2 });
const prod = makeRowOperand({ type: 'PROD', refId1: tav.id, refId2: cons.id, target: 0.5 });
const sloped = makeRowOperand({ type: 'TGT', lambdaStart: 450, lambdaEnd: 650, target: 0.2, targetEnd: 0.8 });
const comment = makeRowOperand({ type: 'BLNK', comment: 'pass band' });
const integral = makeRowOperand({ type: 'TIW', lambdaStart: 400, lambdaEnd: 700, source: { id: 'A' } });
const stress = makeRowOperand({ type: 'STR', cmp: 'ge', target: 0.333 });
const rows = [tav, cons, prod, sloped, comment, integral, stress];

// ── Copied rows paste back whole ─────────────────────────────────────────────
{
    const clipboard = memoryClipboard();
    copySelectedOperands(rows, new Set(rows.map(row => row.id)), clipboard);
    await settle();
    const pasted = (await paste(clipboard, rows, rows.length)).slice(rows.length);
    assert.equal(pasted.length, rows.length);
    const copyOf = new Map(rows.map((row, i) => [row.id, pasted[i].id]));
    pasted.forEach((row, i) => {
        const source = rows[i];
        assert.ok(!rows.some(original => original.id === row.id), `${source.type}: a new id`);
        const expected = { ...source, id: row.id };
        for (const key of REF_KEYS) if (source[key] != null) expected[key] = copyOf.get(source[key]);
        assert.deepEqual(row, expected, `${source.type} comes back whole`);
    });
    assert.equal(pasted[2].refId1, pasted[0].id, 'PROD copied with its TAV reads the TAV copy');
    assert.equal(pasted[2].refId2, pasted[1].id, 'and the CONS copy');

    // Pasted twice, the two copies are separate rows.
    const twice = (await paste(clipboard, rows, rows.length)).slice(rows.length);
    assert.ok(twice.every((row, i) => row.id !== pasted[i].id), 'each paste gives new ids');

    // Windows can hand the text back with CRLF line ends.
    clipboard.set(clipboard.text.replace(/\n/g, '\r\n'));
    const crlf = (await paste(clipboard, rows, rows.length)).slice(rows.length);
    assert.equal(crlf[4].comment, 'pass band', 'CRLF text is still the copied rows');
}

// ── A math row copied without the rows it reads reads the originals ──────────
{
    const clipboard = memoryClipboard();
    copySelectedOperands(rows, new Set([prod.id]), clipboard);
    await settle();
    const [alone] = (await paste(clipboard, rows, rows.length)).slice(rows.length);
    assert.equal(alone.refId1, tav.id);
    assert.equal(alone.refId2, cons.id);
}

// ── Pasting into a cell takes the same whole rows ───────────────────────────
{
    const clipboard = memoryClipboard();
    copySelectedOperands(rows, new Set([comment.id, stress.id]), clipboard);
    await settle();
    const added = [];
    pasteIntoCell({ rowIdx: 0, colKey: 'target', onAdd: items => added.push(...items), commitEdit() {} }, clipboard);
    await settle();
    assert.equal(added.length, 2);
    assert.equal(added[0].comment, 'pass band');
    assert.equal(added[1].cmp, 'ge');
}

// ── Text from elsewhere is read field by field ───────────────────────────────
{
    const clipboard = memoryClipboard();
    copySelectedOperands(rows, new Set([comment.id]), clipboard);
    await settle();
    clipboard.set('TAV\t500\t600\t0\tavg\t\t95\t1');
    const [fromText] = (await paste(clipboard, [], 0));
    assert.equal(fromText.type, 'TAV');
    assert.equal(fromText.target, 0.95);
    assert.ok(fromText.id, 'a row built from text gets an id');
}

// ── The text keeps targets at full precision ─────────────────────────────────
{
    const line = serializeOperandsTsv([tav], new Set([tav.id]));
    assert.equal(line.split('\t')[6], '33.3', 'a fractional target writes as its percent, unrounded');
    assert.equal(parseOperandsTsv(line)[0].target, 0.333, 'and reads back as exactly the same number');
    const fine = { ...tav, target: 0.123456789 };
    assert.equal(parseOperandsTsv(serializeOperandsTsv([fine], new Set([fine.id])))[0].target, 0.123456789);
    const strLine = serializeOperandsTsv([stress], new Set([stress.id]));
    assert.equal(parseOperandsTsv(strLine)[0].target, 0.333, 'a target in its own unit is written in full');
}

console.log('mf_row_clipboard_whole_rows: passed');
