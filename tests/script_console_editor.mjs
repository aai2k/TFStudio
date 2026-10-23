/**
 * The Script Console's editor (scriptConsole/codeEditor.js), CodeMirror 6,
 * driven through its own key handling on the editor state the console makes,
 * with no page: the editor's commands take a state and a dispatch alone.
 *
 * Ctrl+Enter does nothing in the editor itself, so that the box around it
 * runs the script and no new line is typed; Ctrl+Z undoes the typing, and
 * Ctrl+Y and Ctrl+Shift+Z redo it; Ctrl+S, Ctrl+O and Ctrl+N are not the
 * editor's, so they reach
 * the box, which keeps them from the app (script_console_window.mjs checks
 * the box). Tab indents four spaces, and a new line in Python indents after a
 * colon. Each edit hands the text on, which the console keeps as the script
 * and the last script. The language is the script's, the line an error names
 * is marked and follows the lines it is between, and the colours are the
 * app's own, light or dark. The editor's words are the app's language, and
 * every one the editor's packages say is translated.
 *
 * The component itself, as the console's layout draws it: a key pressed in
 * the editor reaches the box around it, so Ctrl+Enter runs the script and
 * Ctrl+Z stays in the editor. An edit goes to the console, which keeps it as
 * the script, through the handler the console handed last, and the console
 * handing back what was typed leaves the editor and its undo history as they
 * are. A script set from outside, as Open sets it, replaces the text with an
 * undo history of its own, in the language picked before; the language, the
 * app's colours and language, and the line an error names, marked and
 * scrolled to, reach the editor as they change.
 *
 * The page loads CodeMirror as the packaged app and the web demo do, bundled,
 * and src/index.html, which a source checkout runs, maps every package the
 * editor's modules import to the file the bundle takes.
 *
 * Run: node tests/script_console_editor.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { loadApp, makeLocale, shimBrowserGlobals } from './_uiShim.mjs';
import { importWithHookRuntime, makeHookRuntime } from './_hookHarness.mjs';

shimBrowserGlobals();
await loadApp();

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITOR = path.join(ROOT, 'src', 'components', 'windows', 'optimization', 'scriptConsole', 'codeEditor.js');
// The editor's module loads under the hook harness, which draws the component
// and records its effects; its other exports do not use React. Each ref the
// component makes is kept, so the test can reach the one that holds its view.
const hooks = makeHookRuntime();
hooks.React.createElement = React.createElement;
const refs = new Set();
const harnessRef = hooks.React.useRef;
hooks.React.useRef = (initial) => {
    const ref = harnessRef(initial);
    refs.add(ref);
    return ref;
};
const { CodeEditor, editorState, editorTheme, highlightRules, markErrorLine, markedErrorLine } = await importWithHookRuntime(
    '../src/components/windows/optimization/scriptConsole/codeEditor.js', hooks);
const { ScriptConsoleLayout } = await import('../src/components/windows/optimization/scriptConsole/ScriptConsoleLayout.js');
const { EditorState } = await import('@codemirror/state');
const { undoDepth } = await import('@codemirror/commands');
const { EditorView, runScopeHandlers } = await import('@codemirror/view');
const { language: languageFacet } = await import('@codemirror/language');
const { getPalette } = await import('../src/constants/colorPalettes.js');

const t = makeLocale('en');
const z = t.scriptConsole;
const dark = getPalette('Dark Gray');
const light = getPalette('Light');

// The editor as the console makes it, with a stand-in for the page: what the
// editor's commands need of a view is its state and its dispatch.
function editor({ text = '', language = 'javascript', c = dark, words = { label: 'Script', placeholder: '', phrases: z.editorPhrases }, errorLine = 0 } = {}) {
    const typed = [];
    const view = {
        state: editorState({ text, language, c, words, errorLine, onChange: value => typed.push(value) }),
        dispatch(tr) {
            view.state = tr.state;
            for (const listener of view.state.facet(EditorView.updateListener)) listener({ docChanged: tr.docChanged, state: tr.state });
        },
    };
    // A key pressed in the editor: whether the editor took it.
    const press = (key, code, keyCode, mods = {}) => runScopeHandlers(view, {
        key, code, keyCode, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods,
        preventDefault() {}, stopPropagation() {},
    }, 'editor');
    const type = (insert) => {
        const at = view.state.selection.main.head;
        view.dispatch(view.state.update({ changes: { from: at, insert }, selection: { anchor: at + insert.length } }));
    };
    const doc = () => view.state.doc.toString();
    return { view, press, type, doc, typed };
}

// ── The keys ────────────────────────────────────────────────────────────────
{
    const e = editor({ text: 'let a = 1;' });
    e.view.dispatch(e.view.state.update({ selection: { anchor: 10 } }));
    assert.equal(e.press('Enter', 'Enter', 13, { ctrlKey: true }), true, 'Ctrl+Enter is taken by the editor');
    assert.equal(e.doc(), 'let a = 1;', 'and types nothing, so the box around it runs the script');
    e.type('\nlet b = 2;');
    assert.equal(e.press('z', 'KeyZ', 90, { ctrlKey: true }), true);
    assert.equal(e.doc(), 'let a = 1;', 'Ctrl+Z undoes the typing in the editor');
    assert.equal(e.press('y', 'KeyY', 89, { ctrlKey: true }), true);
    assert.equal(e.doc(), 'let a = 1;\nlet b = 2;', 'Ctrl+Y redoes it');
    e.press('z', 'KeyZ', 90, { ctrlKey: true });
    assert.equal(e.press('Z', 'KeyZ', 90, { ctrlKey: true, shiftKey: true }), true);
    assert.equal(e.doc(), 'let a = 1;\nlet b = 2;', 'and so does Ctrl+Shift+Z, as in the app');
    for (const [key, code, keyCode] of [['s', 'KeyS', 83], ['o', 'KeyO', 79], ['n', 'KeyN', 78]]) {
        assert.equal(e.press(key, code, keyCode, { ctrlKey: true }), false, `Ctrl+${key.toUpperCase()} is not the editor's, so it reaches the box, which keeps it`);
    }
    assert.deepEqual(e.typed.at(-1), 'let a = 1;\nlet b = 2;', 'each edit hands the text on');
}
{
    const e = editor({ text: '', language: 'python' });
    e.type('def f():');
    assert.equal(e.press('Enter', 'Enter', 13), true);
    assert.equal(e.doc(), 'def f():\n    ', 'a new line after a colon indents four spaces in Python');
    const plain = editor({ text: 'x' });
    plain.view.dispatch(plain.view.state.update({ selection: { anchor: 0 } }));
    assert.equal(plain.press('Tab', 'Tab', 9), true);
    assert.equal(plain.doc(), '    x', 'Tab indents four spaces');
}

// ── The language, the error line, the colours ──────────────────────────────
for (const language of ['javascript', 'python']) {
    assert.equal(editor({ language }).view.state.facet(languageFacet)?.name, language, `the editor reads the script as ${language}`);
}
{
    const e = editor({ text: 'a\nb\nc', errorLine: 2 });
    assert.equal(markedErrorLine(e.view.state), 2, 'the line an error names is marked');
    e.view.dispatch(e.view.state.update({ changes: { from: 0, insert: 'top\n' } }));
    assert.equal(markedErrorLine(e.view.state), 3, 'and stays on that line when lines go in above it');
    e.view.dispatch(e.view.state.update({ effects: markErrorLine(0) }));
    assert.equal(markedErrorLine(e.view.state), 0, 'the console takes the mark away');
    e.view.dispatch(e.view.state.update({ effects: markErrorLine(99) }));
    assert.equal(markedErrorLine(e.view.state), 0, 'a line the script does not have marks nothing');
}
for (const c of [dark, light]) {
    assert.equal(editor({ c }).view.state.facet(EditorView.darkTheme), !c.light, `the editor is ${c.light ? 'light' : 'dark'} as the app is`);
    const own = new Set(Object.values(c).filter(value => typeof value === 'string'));
    const colours = [];
    const walk = (value) => {
        if (value && typeof value === 'object') Object.values(value).forEach(walk);
        else if (typeof value === 'string') colours.push(...(value.match(/#[0-9a-f]{6,8}\b/gi) || []));
    };
    walk(editorTheme(c));
    walk(highlightRules(c).map(({ tag, ...style }) => style));
    for (const colour of colours) {
        assert.ok(own.has(colour.slice(0, 7)), `${colour} is one of the app's own colours, or a wash of one`);
    }
    assert.equal(editorTheme(c)['&'].backgroundColor, c.bg, 'on the window\'s background');
}

// ── The editor's words ──────────────────────────────────────────────────────
{
    const phrases = new Set();
    for (const name of ['view', 'search', 'commands']) {
        const source = fs.readFileSync(path.join(ROOT, 'node_modules', '@codemirror', name, 'dist', 'index.js'), 'utf8');
        for (const [, phrase] of source.matchAll(/phrase\((?:[\w.]+,\s*)?"([^"]+)"/g)) phrases.add(phrase);
    }
    assert.ok(phrases.size >= 15, `the phrases are read from the packages (${phrases.size})`);
    for (const code of ['en', 'ru', 'zh', 'it']) {
        const zl = makeLocale(code).scriptConsole;
        assert.deepEqual(Object.keys(zl.editorPhrases).sort(), [...phrases].sort(), `${code}: every phrase the editor says is translated`);
        const words = { label: zl.editorLabel, placeholder: zl.editorPlaceholder.python, phrases: zl.editorPhrases };
        assert.equal(editor({ words }).view.state.phrase('Find'), zl.editorPhrases.Find, `${code}: and the editor says it`);
    }
    assert.equal(makeLocale('ru').scriptConsole.editorPhrases['replaced $ matches'].includes('$'), true, 'the count still has its place');
}

// ── The editor in the console ───────────────────────────────────────────────
// CodeEditor as the console's layout hands it the script (ScriptConsoleLayout.js).
// Its first effect puts a CodeMirror view in the page, and there is no page
// here: a stand-in view, empty as one no page has drawn yet, takes that view's
// place, and the component's other effects work on it.
{
    const find = (el, test) => {
        if (!el || typeof el !== 'object') return null;
        if (Array.isArray(el)) return el.reduce((hit, child) => hit || find(child, test), null);
        return test(el) ? el : find(el.props?.children, test);
    };
    const ran = [];
    const kept = [];
    let shown = {
        c: dark, t, onTextChange: text => kept.push(['first', text]),
        session: { text: 'a\nb\nc', language: 'javascript', errorLine: 0, fileName: '', filePath: '', output: [], outputHidden: 0 },
    };
    // The console drawn again with `next` changed: the editor's box, and the
    // effects of the component that drawing runs.
    const draw = (next = {}) => {
        shown = { ...shown, ...next, session: { ...shown.session, ...next.session } };
        const { c, t: tl, session, onTextChange } = shown;
        const layout = ScriptConsoleLayout({
            c, t: tl, z: tl.scriptConsole, session, setField() {}, status: null, running: false, runStatus: '',
            onRun: () => ran.push(session.text), onStop() {}, onOpen() {}, onSave() {}, onLanguage() {}, onTextChange,
        });
        const box = find(layout, el => el.type?.name === 'EditorBox');
        const editor = box.type(box.props);
        assert.equal(editor.type, CodeEditor);
        return { host: hooks.render(() => editor.type(editor.props)), effects: hooks.pendingEffects() };
    };
    const redraw = next => draw(next).effects.forEach(effect => effect());

    const view = {
        state: EditorState.create(),
        sent: [],
        dispatch(spec) {
            const tr = view.state.update(spec);
            view.sent.push(tr);
            view.state = tr.state;
            for (const listener of view.state.facet(EditorView.updateListener)) listener({ docChanged: tr.docChanged, state: tr.state });
        },
        setState(state) { view.state = state; },
    };
    const first = draw();
    // The view's ref: not the box's, and empty with no page to draw in.
    [...refs].find(ref => ref !== first.host.ref && ref.current === null).current = view;
    first.effects.slice(1).forEach(effect => effect());
    assert.equal(view.state.doc.toString(), 'a\nb\nc', 'the editor holds the script the console hands it');

    // A key pressed in the editor reaches the box around it, as React hands it on.
    const press = (init) => {
        const calls = [];
        first.host.props.onKeyDown({
            ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init,
            preventDefault: () => calls.push('preventDefault'), stopPropagation: () => calls.push('stopPropagation'),
        });
        return calls;
    };
    assert.deepEqual(press({ key: 'Enter', code: 'Enter', ctrlKey: true }), ['preventDefault']);
    assert.deepEqual(ran, ['a\nb\nc'], 'Ctrl+Enter in the editor runs the script');
    assert.deepEqual(press({ key: 'z', code: 'KeyZ', ctrlKey: true }), ['stopPropagation'],
        'and Ctrl+Z stays in the editor, so it never reaches the app, which would undo the design');

    const type = insert => view.dispatch({ changes: { from: view.state.doc.length, insert } });
    type('\nd');
    assert.deepEqual(kept, [['first', 'a\nb\nc\nd']], 'an edit goes to the console, which keeps it as the script and the last script');
    redraw({ session: { text: 'a\nb\nc\nd' }, onTextChange: text => kept.push(['second', text]) });
    assert.deepEqual([view.state.doc.toString(), undoDepth(view.state)], ['a\nb\nc\nd', 1],
        'the console handing back what was typed leaves the editor as it is, its undo history with it');
    type('e');
    assert.deepEqual(kept.at(-1), ['second', 'a\nb\nc\nde'], 'the next edit goes to the handler the console handed last');

    redraw({ session: { text: 'opened\nfile' } });
    assert.deepEqual([view.state.doc.toString(), undoDepth(view.state)], ['opened\nfile', 0],
        'a script set from outside, as Open sets it, replaces the text, with an undo history of its own');
    redraw({ session: { language: 'python' } });
    assert.equal(view.state.facet(languageFacet)?.name, 'python', 'the language picked reaches the editor');
    redraw({ session: { text: 'print(1)' } });
    assert.equal(view.state.facet(languageFacet)?.name, 'python', 'and a script opened after that is read in it');
    redraw({ c: light });
    assert.equal(view.state.facet(EditorView.darkTheme), false, 'the editor follows the app to its light colours');
    const ru = makeLocale('ru');
    redraw({ t: ru });
    assert.equal(view.state.phrase('Find'), ru.scriptConsole.editorPhrases.Find, 'and to its language');

    const SCROLL = EditorView.scrollIntoView(0).type;
    const scrolled = () => view.sent.at(-1).effects.some(effect => effect.is(SCROLL));
    redraw({ session: { text: 'a\nb\nc' } });
    redraw({ session: { errorLine: 2 } });
    assert.deepEqual([markedErrorLine(view.state), scrolled()], [2, true], 'the line a run\'s error names is marked, and scrolled to');
    redraw({ session: { errorLine: 0 } });
    assert.deepEqual([markedErrorLine(view.state), scrolled()], [0, false], 'the mark goes when the console takes it away');
    redraw({ session: { errorLine: 99 } });
    assert.deepEqual([markedErrorLine(view.state), scrolled()], [0, false], 'a line the script does not have is neither marked nor scrolled to');
}

// ── Loading CodeMirror ──────────────────────────────────────────────────────
{
    const built = await esbuild.build({
        entryPoints: [EDITOR], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
        metafile: true, absWorkingDir: ROOT, logLevel: 'silent',
    });
    const imported = new Map();
    for (const { imports } of Object.values(built.metafile.inputs)) {
        for (const { original, path: file } of imports) if (original && !/^[./]/.test(original)) imported.set(original, file);
    }
    const page = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
    const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(page)[1]).imports;
    assert.ok(page.indexOf('type="importmap"') < page.indexOf('type="module"'), 'the map comes before the app\'s modules');
    assert.deepEqual(Object.keys(map).sort(), [...imported.keys()].sort(), 'src/index.html maps every package the editor imports, and no other');
    for (const [name, file] of imported) {
        assert.equal(path.resolve(ROOT, 'src', map[name]), path.resolve(ROOT, file), `${name} loads the file the bundle takes`);
    }
}

console.log('PASS: script_console_editor');
