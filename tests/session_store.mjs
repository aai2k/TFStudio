/**
 * The unsaved-work session: how it is stored, and what wins at startup.
 *
 * Every copy of the app keeps its own session, so a working copy left in one
 * can meet a file saved later by another. A working copy wins over its file
 * only while the file is still the one it was edited from; a file changed since
 * wins, and the copy is one undo step back. Each design is its own entry,
 * written when that design changes, with every distinct value stored once. An
 * entry leaves when its design is deleted in the app, and at startup only when
 * every file in the Projects folder was read, since an unread file looks like a
 * deleted one.
 *
 * Run: node tests/session_store.mjs
 */
import assert from 'node:assert/strict';

// ── A localStorage that records what is written, with an optional quota in
// characters over all keys and values, as a browser enforces one.
function fakeStorage(quota = Infinity) {
    const map = new Map();
    const log = [];
    const used = () => [...map].reduce((n, [k, v]) => n + k.length + v.length, 0);
    return {
        log,
        get length() { return map.size; },
        key: (i) => [...map.keys()][i] ?? null,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => {
            const text = String(v);
            const after = used() - (map.has(k) ? k.length + map.get(k).length : 0) + k.length + text.length;
            if (after > quota) throw new Error('QuotaExceededError');
            log.push(['set', k]);
            map.set(k, text);
        },
        removeItem: (k) => { log.push(['remove', k]); map.delete(k); },
        clear: () => { map.clear(); log.length = 0; },
        used,
    };
}
let storage = fakeStorage();
globalThis.localStorage = storage;
const useStorage = (s) => { storage = s; globalThis.localStorage = s; };

// ── Just enough React to run useDesignStore: state, refs, and effects run after
// each render, the way React runs them after it commits.
function fakeReact() {
    const slots = [];
    const effects = [];
    let cursor = 0;
    const slotAt = (make) => {
        const i = cursor++;
        if (slots.length <= i) slots[i] = make();
        return slots[i];
    };
    return {
        begin() { cursor = 0; effects.length = 0; },
        runEffects() { effects.splice(0).forEach(fn => fn()); },
        useState(initial) {
            const slot = slotAt(() => ({ value: typeof initial === 'function' ? initial() : initial }));
            return [slot.value, (next) => {
                slot.value = typeof next === 'function' ? next(slot.value) : next;
            }];
        },
        useRef: (initial) => slotAt(() => ({ current: initial })),
        useCallback: (fn) => fn,
        useMemo: (fn) => fn(),
        useEffect: (fn) => { effects.push(fn); },
        createContext: (value) => ({ Provider: 'Provider', value }),
        useContext: (context) => context.value,
        createElement: () => null,
    };
}
const fakeR = fakeReact();
globalThis.React = fakeR;

const {
    encodeTimeline, decodeTimeline, serializeEntry, parseEntry,
    writeSessionEntry, loadSession, MAX_HISTORY,
} = await import('../src/utils/io/appSession.js');
const { designFingerprint, designsEqual } = await import('../src/utils/io/projectPersistence.js');
const {
    sessionEntryFor, mergeSessionOverDisk, storeMergedSession,
} = await import('../src/utils/io/sessionMerge.js');
const { idsLeavingTree } = await import('../src/components/panels/projectExplorerModel.js');
const { useDesignStore } = await import('../src/hooks/useDesignStore.js');

let passed = 0;
function ok(condition, message) {
    assert.ok(condition, message);
    passed++;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const OPERANDS = [
    { id: 'op1', type: 'RGT', lambdaStart: 400, lambdaEnd: 700, target: 0, weight: 1 },
    { id: 'op2', type: 'MNT', lambdaStart: 1, lambdaEnd: 1000, target: 15, weight: 1 },
];
const MEASURED = Array.from({ length: 200 }, (_, i) => ({ lambda: 400 + i, psi: 20 + i / 10, delta: 90 }));

function design(id, thicknesses, extra = {}) {
    return {
        id, name: `Design ${id}`,
        substrate: { material: 'BK7', thickness: 1 },
        frontLayers: thicknesses.map((d, i) => ({ id: `l-${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness: d })),
        backLayers: [],
        meritOperands: OPERANDS,
        ...extra,
    };
}
const noHistory = () => ({ past: [], future: [] });

// ── 1. A timeline is stored with every distinct value once ───────────────────
{
    const a = design('A', [100, 80, 60], { measuredEllipsometry: MEASURED });
    const b = { ...a, frontLayers: [...a.frontLayers, { id: 'l-3', material: 'TiO2', thickness: 13 }] };
    const c = { ...b, frontLayers: b.frontLayers.map((l, i) => (i === 1 ? { ...l, thickness: 85 } : l)) };
    const d = { ...c, notes: 'changed' };
    const timeline = [a, b, c, d];
    const { snaps, texts } = encodeTimeline(timeline);
    const values = texts.map(t => JSON.parse(t));
    const back = decodeTimeline(values, snaps);

    ok(back.every((snap, i) => JSON.stringify(snap) === JSON.stringify(timeline[i])),
        'every step comes back exactly, field order included');
    ok(back[0].meritOperands[0] === back[3].meritOperands[0],
        'an unchanged operand comes back as one object shared by every step');
    ok(back[0].frontLayers[0] === back[3].frontLayers[0] && back[1].frontLayers[3] === back[2].frontLayers[3],
        'an unchanged layer is shared too, element by element');
    ok(back[1].frontLayers[1] !== back[2].frontLayers[1],
        'while the layer the edit changed is stored twice, once per value');

    const measuredCopies = texts.filter(t => t.includes('"psi"')).length;
    ok(measuredCopies === MEASURED.length,
        `the measured data is stored once for four steps (${measuredCopies} point texts for ${MEASURED.length} points)`);
    const plain = JSON.stringify(timeline).length;
    const stored = JSON.stringify(snaps).length + texts.join(',').length;
    ok(stored < plain / 2, `four steps take ${stored} characters stored against ${plain} as full copies`);
}

// ── 2. An entry round trips, with the history trimmed to MAX_HISTORY ─────────
{
    const steps = Array.from({ length: MAX_HISTORY + 7 }, (_, i) => design('A', [100 + i]));
    const present = design('A', [999]);
    const redo = Array.from({ length: MAX_HISTORY + 3 }, (_, i) => design('A', [500 + i]));
    const text = serializeEntry({ design: present, history: { past: steps, future: redo }, base: 'abc' });
    const e = parseEntry(text);
    ok(designsEqual(e.design, present), 'the design comes back');
    ok(e.history.past.length === MAX_HISTORY && e.history.past[0].frontLayers[0].thickness === 107,
        'the undo list keeps its newest MAX_HISTORY steps');
    ok(e.history.future.length === MAX_HISTORY && e.history.future[0].frontLayers[0].thickness === 500,
        'the redo list keeps its oldest MAX_HISTORY steps');
    ok(e.base === 'abc', 'the fingerprint comes back');
    const noBase = parseEntry(serializeEntry({ design: present, history: null, base: null }));
    ok(noBase.base === null && noBase.history.past.length === 0, 'an entry with no fingerprint and no history');
}

// ── 3. The fingerprint sees what the dirty comparison sees, name aside ───────
{
    const a = design('A', [100, 80]);
    const reordered = Object.fromEntries(Object.entries(a).reverse());
    ok(designFingerprint(a) === designFingerprint(reordered), 'key order does not change it');
    ok(designFingerprint(a) === designFingerprint({ tfs_version: '1.2', materials: { 'user:X': {} }, ...a }),
        'nor do the format stamp and the embedded material block');
    ok(designFingerprint(a) !== designFingerprint(design('A', [100, 81])), 'a thickness does');
    ok(designFingerprint(a) === designFingerprint({ ...a, name: 'Renamed' }),
        'a rename does not: the copy takes the file name when it is restored');
    ok(designFingerprint(null) === null, 'no design, no fingerprint');

    // A design built without a back layer list (the Filter Design wizard's) is
    // read back from its file with an empty one.
    const { backLayers: _b, ...built } = a;
    ok(designFingerprint(built) === designFingerprint(a) && designsEqual(built, a),
        'a missing layer list counts as an empty one, as load-folders fills it in');
    ok(designsEqual({ ...a, backLayers: null }, a), 'and so does a null one');
}

// ── 4. Which designs get an entry ────────────────────────────────────────────
{
    const disk = design('A', [100]);
    ok(sessionEntryFor(disk, noHistory(), disk) === null, 'a design that matches its file and has no history has none');
    const edited = design('A', [120]);
    const e1 = sessionEntryFor(edited, noHistory(), disk);
    ok(e1 && e1.design === edited && e1.base === designFingerprint(disk),
        'an unsaved design has one, fingerprinted with its file');
    const e2 = sessionEntryFor(disk, { past: [edited], future: [] }, disk);
    ok(e2 && e2.history.past.length === 1, 'a saved design with undo history has one');
    ok(sessionEntryFor(undefined, noHistory(), disk) === null, 'a design gone from the store has none');
}

// ── 5. What wins at startup ──────────────────────────────────────────────────
{
    const file = design('A', [100]);
    const copy = design('A', [120]);
    const history = { past: [design('A', [110])], future: [design('A', [130])] };
    const entry = (d, base, h = history) => ({ design: d, history: h, base });

    let m = mergeSessionOverDisk({ A: file }, { A: entry(copy, designFingerprint(file)) });
    ok(m.initialDesigns.A === copy && m.initialDirty.A && m.history.A === history,
        'over the file it was edited from, the working copy wins, unsaved, with its history');
    ok(m.replaced.length === 0 && m.rewrite.length === 0, 'and nothing needs rewriting');

    const savedSince = design('A', [140]);
    m = mergeSessionOverDisk({ A: savedSince }, { A: entry(copy, designFingerprint(file)) });
    ok(m.initialDesigns.A === savedSince && !m.initialDirty.A,
        'over a file saved since, the file wins and is not marked unsaved');
    const past = m.history.A.past;
    ok(past.length === 2 && past[1] === copy && m.history.A.future.length === 0,
        'the working copy is the last undo step, and its redo steps are dropped');
    ok(m.replaced[0] === 'A' && m.rewrite[0] === 'A', 'the design is reported and its entry rewritten');

    m = mergeSessionOverDisk({ A: copy }, { A: entry(copy, designFingerprint(file)) });
    ok(m.initialDesigns.A === copy && m.history.A === history && m.replaced.length === 0,
        'a file saved since with the same content as the copy: nothing is added to the undo list');

    // Saved, then kept only for its undo list: the copy is the old file.
    m = mergeSessionOverDisk({ A: savedSince }, { A: entry(file, designFingerprint(file)) });
    ok(m.initialDesigns.A === savedSince && m.history.A.past.at(-1) === file,
        'a copy that matched its file still becomes the last undo step when the file changes');
    ok(m.replaced.length === 0, 'but no unsaved edits are reported lost, because it had none');

    m = mergeSessionOverDisk({ A: savedSince }, { A: entry(copy, null) });
    ok(m.initialDesigns.A === copy && m.initialDirty.A,
        'a copy with no fingerprint, from a 1.8.1 session, wins over the file');

    const renamedElsewhere = { ...file, name: 'Canonical title' };
    m = mergeSessionOverDisk({ A: renamedElsewhere }, { A: entry(copy, designFingerprint(file)) });
    ok(m.initialDesigns.A.name === 'Canonical title' && m.initialDesigns.A.frontLayers[0].thickness === 120,
        'a file renamed elsewhere keeps the copy, under the file name');
    ok(m.replaced.length === 0, 'and a rename alone is not a change to the file');

    const entries = { A: entry(copy, designFingerprint(file)), GONE: entry(copy, 'x') };
    m = mergeSessionOverDisk({ A: file }, entries);
    ok(!m.initialDesigns.GONE && m.dropped.length === 0,
        'an entry whose file was not found is left out of the store and kept in storage');
    m = mergeSessionOverDisk({ A: file }, entries, { dropMissing: true });
    ok(!m.initialDesigns.GONE && m.dropped[0] === 'GONE',
        'and dropped only when every file in the Projects folder was read');
}

// ── 6. A copy stored against an empty file, then the file saved elsewhere ────
{
    // Created in one copy of the app, where the new design's file is written
    // empty; grown to 600 layers there and never saved.
    const created = design('D10', []);
    const grown = design('D10', Array.from({ length: 600 }, (_, i) => (i < 500 ? 13 : 100)));
    const stored = sessionEntryFor(grown, { past: [design('D10', [100])], future: [] }, created);
    // Another copy then saved Design 10 with one layer.
    const savedElsewhere = design('D10', [100]);
    const m = mergeSessionOverDisk({ D10: savedElsewhere }, { D10: parseEntry(serializeEntry(stored)) });
    ok(m.initialDesigns.D10.frontLayers.length === 1 && !m.initialDirty.D10,
        'the design opens with the 1 layer saved elsewhere, not marked unsaved');
    ok(m.history.D10.past.at(-1).frontLayers.length === 600 && m.replaced[0] === 'D10',
        'one Ctrl+Z brings the 600 layers back, and the notice names the design');
}

// ── 7. A 1.8.1 session is read once and rewritten as entries ─────────────────
const v3Session = (designs, history = {}) => JSON.stringify({ version: 3, designs, history });
{
    const a = design('A', [100]);
    const b = design('B', [200]);
    const orphan = design('O', [300]);
    storage.clear();
    storage.setItem('tfstudio-session-v3', v3Session(
        { A: design('A', [120]), B: b, O: orphan },
        { A: { past: [design('A', [90])], future: [] } }));
    const s = loadSession();
    ok(s.legacy && s.entries.A.design.frontLayers[0].thickness === 120 && s.entries.A.base === null,
        'a 1.8.1 session is read, with no fingerprints');
    ok(s.entries.A.history.past.length === 1 && s.entries.B.history.past.length === 0,
        'its undo lists come with it');

    const disk = { A: a, B: b };
    const merged = mergeSessionOverDisk(disk, s.entries);
    storeMergedSession(s, merged, disk);
    const after = loadSession();
    ok(!after.legacy && storage.getItem('tfstudio-session-v3') === null, 'the 1.8.1 value is gone');
    ok(Object.keys(after.entries).sort().join() === 'A,O',
        'A keeps its unsaved copy, B matched its file and needs no entry, O was not found and is kept');
    ok(after.entries.A.base === designFingerprint(a) && after.entries.A.history.past.length === 1,
        'the rewritten entry carries its fingerprint and its undo list');

    writeSessionEntry('A', null);
    writeSessionEntry('O', null);
    ok(loadSession() === null, 'removing the last entry leaves no session');
}
{
    // A store near its quota, as a session that grew with every edit leaves
    // it: the entries fit only in the space the old value frees.
    const designs = {};
    const history = {};
    const disk = {};
    for (let i = 0; i < 20; i++) {
        const id = `D${i}`;
        disk[id] = design(id, [100 + i], { measuredEllipsometry: MEASURED });
        designs[id] = { ...disk[id], notes: 'unsaved' };
        history[id] = { past: Array.from({ length: 5 }, (_, k) => ({ ...disk[id], notes: `step ${k}` })), future: [] };
    }
    const legacyText = v3Session(designs, history);
    useStorage(fakeStorage(legacyText.length + 'tfstudio-session-v3'.length + 20000));
    storage.setItem('tfstudio-session-v3', legacyText);
    const s = loadSession();
    storeMergedSession(s, mergeSessionOverDisk(disk, s.entries), disk);
    const after = loadSession();
    ok(!after.legacy && Object.keys(after.entries).length === 20,
        `with the old value near the quota, all 20 entries are written (${storage.used()} of ${legacyText.length} characters used)`);
    ok(Object.values(after.entries).every(e => e.design.notes === 'unsaved' && e.history.past.length === 5),
        'each with its unsaved copy and undo list');
    useStorage(fakeStorage());
}

// ── 8. Deleting one of two rows that share an id keeps the other design ─────
{
    const folders = [
        { id: 'Project', items: [{ id: 'X' }, { id: 'Y' }] },
        { id: 'Project backup', items: [{ id: 'X' }, { id: 'Z' }] },
    ];
    const byFolder = idsLeavingTree(folders, new Set(['X', 'Z']), f => f.id === 'Project backup');
    ok(byFolder.has('Z') && !byFolder.has('X'),
        'deleting the backup folder takes Z, and leaves X, which the other folder still shows');
    const byRow = idsLeavingTree(folders, new Set(['Y']), (f, i) => f.id === 'Project' && i.id === 'Y');
    ok(byRow.has('Y') && byRow.size === 1, 'deleting a row whose id is nowhere else takes it');
}

// ── 9. The store writes the design that changed, and only that one ───────────
{
    storage.clear();
    let store;
    const render = () => { fakeR.begin(); store = useDesignStore(); fakeR.runEffects(); };
    render();

    const diskA = design('A', [100]);
    const diskB = design('B', [200], { measuredEllipsometry: MEASURED });
    store.diskDesignsRef.current = { A: diskA, B: diskB };
    store.setDesigns({ A: diskA, B: diskB });
    render();
    storage.log.length = 0;

    const editedA = design('A', [125]);
    store.handleDesignChange('A', editedA);
    render();
    await sleep(600);
    ok(storage.log.length === 1 && storage.log[0][0] === 'set' && storage.log[0][1].endsWith(':A'),
        `an edit to A writes A's entry and nothing else (${JSON.stringify(storage.log)})`);
    let entryA = loadSession().entries.A;
    ok(designsEqual(entryA.design, editedA) && entryA.history.past.length === 1
        && entryA.base === designFingerprint(diskA), 'with the edit, its undo step and its file');

    // Ctrl+S: the file now holds the edit, and the entry follows it.
    store.diskDesignsRef.current.A = JSON.parse(JSON.stringify(editedA));
    store.scheduleSessionSave('A');
    await sleep(600);
    entryA = loadSession().entries.A;
    ok(entryA.base === designFingerprint(editedA), 'after a save the entry is fingerprinted with the saved file');

    storage.log.length = 0;
    store.dropDesigns(new Set(['A']));
    render();
    ok(!store.designs.A && !store.historyRef.current.A, 'a deleted design leaves the store');
    ok(storage.log.some(([op, k]) => op === 'remove' && k.endsWith(':A')), 'and its entry is removed');
    ok(!loadSession(), 'leaving no session behind');

    // An edit and its undo leave B matching its file but with a redo step,
    // which is history worth keeping.
    store.handleDesignChange('B', design('B', [210], { measuredEllipsometry: MEASURED }));
    render();
    store.setActiveDesignId('B');
    render();
    store.undo();
    render();
    await sleep(600);
    const entryB = loadSession().entries.B;
    ok(designsEqual(entryB.design, diskB) && entryB.history.future.length === 1,
        'an undo back to the saved state keeps the redo step');
}

console.log(`session_store: ${passed} passed`);
