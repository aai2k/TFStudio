/**
 * Script Console window: where the ribbon and the help reach it, what it
 * draws, its keys, and what a run's answer does to the open design.
 *
 * The window is the Scripts group of the Optimization tab, with its icon in
 * the ribbon and on its help page, which exists in both documentation
 * languages. It works with no design open, and is handed the app's confirm
 * dialog. It draws Run, Open and Save in one row over the editor and the
 * output, split by a divider, in every language; Run is off while the editor
 * is empty, and Stop takes its place while a script runs. The output's first
 * line says how many earlier lines it does not show, in every language, and a
 * cut line says how much of it is not shown. Ctrl+Enter in the editor runs the
 * script, and the app's Ctrl+Z, Ctrl+Y, Ctrl+S, Ctrl+O and Ctrl+N stay in the
 * editor on any keyboard layout.
 *
 * A run's design is applied without its id and name, with one write and no
 * checkpoint. It goes only to the design the run started on and only while
 * that design is unchanged: after an edit, an undo, a design switch, during
 * another window's optimization run, or with no design open at the start, the
 * output says why it was not applied and nothing is written.
 * script_console_run.mjs drives the same through the window's run and the
 * app's design store, and checks there that the write is one undo step.
 *
 * Run: node tests/script_console_window.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [
    { ScriptConsole }, { ScriptConsoleLayout, editorKeyDown, outputText }, { finishRun, runStatus }, { scriptConsoleSession },
    { designAtRun, runDesignDecision }, { WINDOW_REGISTRY }, { makeTabs, ICONS, iconColorForTool }, docsIcons,
] = await Promise.all([
    import('../src/components/windows/optimization/scriptConsole/ScriptConsole.js'),
    import('../src/components/windows/optimization/scriptConsole/ScriptConsoleLayout.js'),
    import('../src/components/windows/optimization/scriptConsole/useScriptRun.js'),
    import('../src/components/windows/optimization/scriptConsole/sessionState.js'),
    import('../src/state/runDesignApply.js'),
    import('../src/components/docking/windowRegistry.js'),
    import('../src/components/Toolbar.js'),
    import('../docs-site/src/components/ribbon-icons.js'),
]);

const c = makeTheme();
const t = makeLocale('en');
const z = t.scriptConsole;
const attr = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const render = (tl) => renderToStaticMarkup(withDesign(React.createElement(ScriptConsole, { c, t: tl })));

// ── Registered, on the ribbon, with a help page ─────────────────────────────
{
    const entry = WINDOW_REGISTRY['script-console'];
    assert.equal(entry.component, ScriptConsole);
    assert.equal(entry.help, 'automation/script-console');
    assert.ok(!entry.requiresDesign, 'a script runs with no design open, on tf.design null');
    assert.equal(entry.dialog, true, 'the window is handed the app\'s confirm dialog, which Open asks in');
    const optimization = makeTabs(t).find(tab => tab.key === 'optimization');
    const scripts = optimization.groups.find(group => group.key === 'scripts');
    assert.deepEqual(scripts?.items.map(item => item.id), ['script-console'], 'the Scripts group of the Optimization tab');
    assert.equal(scripts.label, t.toolbar.groups.scripts);
    assert.ok(ICONS['script-console'] && iconColorForTool('script-console'), 'the ribbon button has an icon and a colour');
    assert.ok(docsIcons.ICONS['script-console'], 'the help page has the icon too');
    for (const slug of ['automation/script-console.md', 'zh/automation/script-console.md']) {
        const page = new URL(`../docs-site/src/content/docs/${slug}`, import.meta.url);
        assert.ok(existsSync(page), `help page ${slug} exists`);
        assert.match(readFileSync(page, 'utf8'), /^ribbonIcon: script-console$/m, `${slug} shows the ribbon icon`);
    }
}

// ── Every language: the row, the editor and the output ──────────────────────
for (const code of ['en', 'ru', 'zh', 'it']) {
    scriptConsoleSession.reset();
    const tl = makeLocale(code);
    const zl = tl.scriptConsole;
    const html = render(tl);
    for (const shown of [`▶ ${zl.run}`, zl.openBtn, zl.saveBtn]) assert.ok(html.includes(`>${shown}</button>`), `${code}: ${shown}`);
    for (const label of [zl.runTip, zl.openTip, zl.saveTip]) assert.ok(html.includes(`title="${attr(label)}"`), `${code}: ${label}`);
    assert.ok(html.includes(`placeholder="${attr(zl.editorPlaceholder)}"`), `${code}: the editor says what tf is`);
    assert.ok(html.includes(`placeholder="${attr(zl.outputPlaceholder)}"`), `${code}: the output says what it shows`);
    assert.equal((html.match(/<textarea/g) || []).length, 2, `${code}: an editor and an output`);
    assert.ok(html.includes('row-resize'), `${code}: a divider between them`);
    scriptConsoleSession.write(null, { output: ['last line'], outputHidden: 7 });
    assert.ok(render(tl).includes(`>${zl.outputHidden(7)}\nlast line</textarea>`), `${code}: the output says how many earlier lines it does not show`);
}
assert.equal(outputText(z, ['a', { text: 'b', cut: 3 }], 0), `a\nb${z.lineCut(3)}`, 'a cut line says how much of it is not shown');
assert.equal(outputText(z, [], 0), '', 'an empty output is empty');

// ── Run is off with nothing to run; the file and the output are shown ───────
{
    scriptConsoleSession.reset();
    const off = render(t);
    assert.match(off, new RegExp(`<button[^>]*disabled=""[^>]*>▶ ${z.run}</button>`), 'an empty editor has nothing to run');
    scriptConsoleSession.write(null, {
        text: 'console.log(1);', fileName: 'ar.js', filePath: 'C:\\scripts\\ar.js', output: ['printed line'],
    });
    const on = render(t);
    assert.doesNotMatch(on, new RegExp(`<button[^>]*disabled=""[^>]*>▶ ${z.run}</button>`), 'a script can run');
    for (const shown of ['>console.log(1);</textarea>', '>printed line</textarea>']) {
        assert.ok(on.includes(shown), `shows ${shown}`);
    }
    assert.match(on, /<span title="C:\\scripts\\ar\.js"[^>]*>ar\.js<\/span>/, 'the file\'s name, its path on hover');

    const props = {
        c, t, z, session: scriptConsoleSession.read(null), setField() {}, status: null, running: true, runStatus: z.running(3),
        onRun() {}, onStop() {}, onOpen() {}, onSave() {},
    };
    const running = renderToStaticMarkup(React.createElement(ScriptConsoleLayout, props));
    assert.ok(running.includes(`>■ ${z.stop}</button>`) && !running.includes(`▶ ${z.run}`), 'Stop takes Run\'s place while a script runs');
    assert.ok(running.includes(`>${z.running(3)}</span>`), 'and the row shows how long it has run');
    scriptConsoleSession.reset();
}

// ── The run's state in the row ──────────────────────────────────────────────
assert.equal(runStatus(z, { run: { started: 1000 }, ended: null, now: 13999 }), z.running(12));
assert.equal(runStatus(z, { run: null, ended: { state: 'done', seconds: 3.04 }, now: 0 }), z.doneIn('3.0'));
assert.equal(runStatus(z, { run: null, ended: { state: 'stopped', seconds: 5 }, now: 0 }), z.stoppedAfter('5.0'));
assert.equal(runStatus(z, { run: null, ended: { state: 'failed', seconds: 0.25 }, now: 0 }), z.failedAfter('0.3'));
assert.equal(runStatus(z, { run: null, ended: null, now: 0 }), '');
assert.match(makeLocale('ru').scriptConsole.running(4), / с$/, 'Russian writes seconds in its own script');

// ── The editor's keys ───────────────────────────────────────────────────────
{
    const press = (init) => {
        const calls = [];
        const event = {
            ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, code: '', ...init,
            preventDefault: () => calls.push('preventDefault'), stopPropagation: () => calls.push('stopPropagation'),
        };
        editorKeyDown(event, () => calls.push('run'));
        return calls;
    };
    assert.deepEqual(press({ key: 'Enter', ctrlKey: true }), ['preventDefault', 'run'], 'Ctrl+Enter runs');
    assert.deepEqual(press({ key: 'Enter' }), [], 'Enter is a new line');
    for (const [key, code] of [['z', 'KeyZ'], ['y', 'KeyY'], ['s', 'KeyS'], ['o', 'KeyO'], ['n', 'KeyN'], ['Z', 'KeyZ']]) {
        assert.deepEqual(press({ key, code, ctrlKey: true, shiftKey: key === 'Z' }), ['stopPropagation'], `Ctrl+${key} stays in the editor`);
    }
    assert.deepEqual(press({ key: 'я', code: 'KeyZ', ctrlKey: true }), ['stopPropagation'], 'on a Cyrillic layout too');
    for (const key of ['c', 'v', 'a', 'f']) assert.deepEqual(press({ key, code: `Key${key.toUpperCase()}`, ctrlKey: true }), [], `Ctrl+${key} is left alone`);
    assert.deepEqual(press({ key: 'F1' }), [], 'Help still opens');
}

// ── What an answer does to the open design ──────────────────────────────────
{
    const stored = { ...makeSampleDesign(), id: 'd1', name: 'Mine', note: 'kept by the explorer' };
    const other = { ...makeSampleDesign(), id: 'd2', name: 'Other' };
    const result = { ...stored, id: 'worker id', name: 'Renamed', frontLayers: [{ id: 'n', material: 'builtin:SiO2', thickness: 50 }] };
    delete result.note;
    const atRun = designAtRun({ activeDesignId: 'd1', designs: { d1: stored, d2: other } });

    // Each case: the app as it is when the answer comes, and what it does.
    const app = (activeDesignId, designs, isOptimizing = false) => {
        const calls = [];
        return {
            calls, activeDesignId, designs, isOptimizing,
            checkpoint: () => calls.push(['checkpoint']),
            updateDesign: (patch, opts) => calls.push(['updateDesign', patch, opts]),
        };
    };
    const done = { state: 'done', design: result };

    const same = app('d1', { d1: stored, d2: other });
    assert.deepEqual(finishRun(z, done, atRun, same), [z.applied]);
    assert.equal(same.calls.length, 1, 'one write and no checkpoint, which would be a second undo step');
    const [kind, patch, opts] = same.calls[0];
    assert.equal(kind, 'updateDesign');
    assert.equal(opts, undefined, 'the write is not transient');
    assert.ok(!('id' in patch) && !('name' in patch), 'the id and the name stay the design\'s own');
    assert.deepEqual(patch.frontLayers, result.frontLayers);
    assert.ok('note' in patch && patch.note === undefined, 'a key the script dropped goes');

    for (const [what, now, reason] of [
        ['an edit or an undo during the run', app('d1', { d1: { ...stored }, d2: other }), 'edited'],
        ['another design selected', app('d2', { d1: stored, d2: other }), 'switched'],
        ['the design closed', app(null, { d1: stored, d2: other }), 'switched'],
        ['an optimization run in another window', app('d1', { d1: stored, d2: other }, true), 'optimizing'],
    ]) {
        assert.deepEqual(finishRun(z, done, atRun, now), [z.notApplied[reason]], `${what}: the output says why`);
        assert.deepEqual(now.calls, [], `${what}: nothing is written`);
    }
    const none = app('d1', { d1: stored });
    assert.deepEqual(finishRun(z, done, designAtRun({ activeDesignId: null, designs: {} }), none), [z.notApplied.noDesign]);
    assert.deepEqual(none.calls, [], 'no design open at the start: nothing is written');

    const quiet = app('d1', { d1: stored });
    assert.deepEqual(finishRun(z, { state: 'done' }, atRun, quiet), [], 'a design left alone adds nothing');
    assert.deepEqual(finishRun(z, { state: 'done', invalid: 'No substrate.' }, atRun, quiet), [z.notADesign('No substrate.')]);
    assert.deepEqual(finishRun(z, { state: 'failed', error: 'TypeError: x\n    at my.js:2:6' }, atRun, quiet), ['TypeError: x\n    at my.js:2:6']);
    assert.deepEqual(finishRun(z, { state: 'failed', error: null }, atRun, quiet), [z.noAnswer]);
    assert.deepEqual(finishRun(z, { state: 'stopped' }, atRun, quiet), [z.stoppedNote]);
    assert.deepEqual(finishRun(z, { state: 'unavailable' }, atRun, quiet), [z.desktopOnly], 'the web demo says scripts need the desktop app');
    assert.deepEqual(quiet.calls, [], 'none of these writes anything');

    // The rule on its own, as another caller takes it.
    assert.deepEqual(runDesignDecision(atRun, { activeDesignId: 'd1', designs: { d1: stored } }, null), { apply: false, reason: 'unchanged' });
}

console.log('PASS: script_console_window');
