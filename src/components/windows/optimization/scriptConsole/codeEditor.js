/**
 * The Script Console's editor: CodeMirror 6, with the script's language
 * highlighted, line numbers, bracket matching, search (Ctrl+F) and the line a
 * run's error names marked. It takes the app's colours, light or dark, and
 * says its own words (the search panel's) in the app's language.
 *
 * Ctrl+Enter runs the script and the app's own chords stay in the editor,
 * which the box around it sees to (ScriptConsoleLayout.js editorKeyDown): a
 * key CodeMirror handles still reaches the box, since no binding here stops
 * it.
 */

import { Compartment, EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, drawSelection, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo } from '@codemirror/commands';
import { HighlightStyle, LanguageSupport, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import { pythonLanguage } from '@codemirror/lang-python';
import { tags } from '@lezer/highlight';

const { createElement: h, useEffect, useRef } = React;

const TEXT_FONT = 'ui-monospace, Consolas, monospace';

// Highlighting and indentation alone: completion of tf comes later.
const MODES = {
    javascript: new LanguageSupport(javascriptLanguage),
    python: new LanguageSupport(pythonLanguage),
};

// The parts of the editor that change while it is open.
const mode = new Compartment();
const look = new Compartment();
const words = new Compartment();

// Ctrl+Enter runs the script, which the box around the editor does, so the
// editor's own Ctrl+Enter, a new line below the cursor, is taken first and
// does nothing. Ctrl+Shift+Z redoes, as it does in the app and in a text box,
// where CodeMirror redoes with it on macOS and Linux alone.
const appKeys = Prec.highest(keymap.of([
    { key: 'Mod-Enter', run: () => true },
    { key: 'Mod-Shift-z', run: redo, preventDefault: true },
]));

const setErrorLine = StateEffect.define();
const ERROR_LINE = Decoration.line({ class: 'cm-errorLine' });

// Line `line` of `doc` marked, or nothing for 0 or a line it does not have.
const errorMarks = (doc, line) => (line > 0 && line <= doc.lines
    ? Decoration.set([ERROR_LINE.range(doc.line(line).from)])
    : Decoration.none);

// The line a run's error names, marked until the console takes the mark away.
const errorLineField = StateField.define({
    create: () => Decoration.none,
    update(marks, tr) {
        const set = tr.effects.find(effect => effect.is(setErrorLine));
        return set ? errorMarks(tr.state.doc, set.value) : marks.map(tr.changes);
    },
    provide: field => EditorView.decorations.from(field),
});

/** The effect that marks line `line` as the one an error names, 0 for none. */
export const markErrorLine = line => setErrorLine.of(line);

/** The line of `state` marked as the one an error names, or 0 for none. */
export function markedErrorLine(state) {
    const marks = state.field(errorLineField);
    return marks.size ? state.doc.lineAt(marks.iter().from).number : 0;
}

/**
 * The editor's colours, all the app's own: its background and text, the
 * accent for keywords, the success colour for strings, the warning colour
 * for numbers and constants, the dimmed text for comments. `c` is the app's
 * palette; a colour with an alpha added is a wash of it.
 */
export function editorTheme(c) {
    const wash = (color, alpha) => `${color}${alpha}`;
    return {
        '&': { height: '100%', width: '100%', backgroundColor: c.bg, color: c.text, fontSize: '12px' },
        '&.cm-focused': { outline: 'none' },
        '.cm-scroller': { fontFamily: TEXT_FONT, lineHeight: '1.45' },
        '.cm-content': { caretColor: c.text, padding: '8px 0' },
        '.cm-line': { padding: '0 8px' },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: c.text },
        '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: c.selected },
        '.cm-gutters': { backgroundColor: c.bg, color: c.textDim, border: 'none', borderRight: `1px solid ${c.border}` },
        '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'transparent', outline: `1px solid ${c.borderStrong}` },
        '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'transparent', color: c.error },
        '.cm-placeholder': { color: c.textDim },
        '.cm-errorLine': { backgroundColor: wash(c.error, c.light ? '20' : '30') },
        '.cm-searchMatch': { backgroundColor: wash(c.warning, '40') },
        '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: wash(c.warning, '80') },
        '.cm-panels': { backgroundColor: c.panel, color: c.text },
        '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${c.border}` },
        '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${c.border}` },
        '.cm-panel label': { fontSize: '11px', color: c.textDim },
        '.cm-textfield, .cm-button': {
            backgroundColor: c.field, backgroundImage: 'none', color: c.text,
            border: `1px solid ${c.border}`, borderRadius: '3px', fontSize: '11px',
        },
    };
}

/** How the script's text is coloured, as editorTheme says. */
export function highlightRules(c) {
    return [
        { tag: tags.keyword, color: c.accent },
        { tag: [tags.string, tags.regexp], color: c.success },
        { tag: [tags.number, tags.bool, tags.null, tags.atom], color: c.warning },
        { tag: tags.comment, color: c.textDim, fontStyle: 'italic' },
        { tag: tags.invalid, color: c.error },
    ];
}

const lookOf = c => [
    EditorView.theme(editorTheme(c), { dark: !c.light }),
    syntaxHighlighting(HighlightStyle.define(highlightRules(c))),
];

// What the editor says: `label` its accessible name, `placeholder` what an
// empty editor shows, `phrases` the search panel's words.
const wordsOf = ({ label, placeholder: empty, phrases }) => [
    EditorState.phrases.of(phrases),
    placeholder(empty),
    EditorView.contentAttributes.of({ 'aria-label': label }),
];

/**
 * A new editor state holding `text`: the script's `language`, the app's
 * colours `c`, the editor's `words` (wordsOf), `errorLine` the line marked,
 * and `onChange(text)` called with the text after each edit made in the
 * editor. Indentation is four spaces, Python's own, for both languages; Tab
 * indents, and Escape then Tab leaves the editor.
 */
export function editorState({ text, language, c, words: said, errorLine, onChange }) {
    return EditorState.create({
        doc: text,
        extensions: [
            lineNumbers(), history(), drawSelection(), indentOnInput(), bracketMatching(),
            EditorState.tabSize.of(4), indentUnit.of('    '),
            appKeys,
            keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
            mode.of(MODES[language]),
            look.of(lookOf(c)),
            words.of(wordsOf(said)),
            errorLineField.init(state => errorMarks(state.doc, errorLine)),
            EditorView.updateListener.of((update) => {
                if (update.docChanged) onChange(update.state.doc.toString());
            }),
        ],
    });
}

/**
 * The editor, in a box that fills its place. `text` is the script, set from
 * outside the editor when it differs from what the editor holds, as Open or
 * the last script coming back sets it, which starts the editor afresh with
 * its own undo history. `errorLine` is the line to mark, 0 for none.
 * `onKeyDown` is the box's, which sees every key pressed in the editor.
 */
export function CodeEditor({ c, text, language, errorLine, words: said, onChange, onKeyDown }) {
    const host = useRef(null);
    const view = useRef(null);
    const latest = useRef(null);
    latest.current = { c, text, language, words: said, errorLine, onChange };
    const fresh = () => editorState({ ...latest.current, onChange: typed => latest.current.onChange(typed) });
    const change = (effects) => { view.current?.dispatch({ effects }); };

    useEffect(() => {
        const editor = new EditorView({ parent: host.current, state: fresh() });
        view.current = editor;
        return () => {
            editor.destroy();
            view.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        const editor = view.current;
        if (editor && editor.state.doc.toString() !== text) editor.setState(fresh());
    }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => change(mode.reconfigure(MODES[language])), [language]);
    useEffect(() => change(look.reconfigure(lookOf(c))), [c]);
    useEffect(() => change(words.reconfigure(wordsOf(said))), [said]);
    useEffect(() => {
        const doc = view.current?.state.doc;
        if (!doc) return;
        const shown = errorLine > 0 && errorLine <= doc.lines ? [EditorView.scrollIntoView(doc.line(errorLine).from, { y: 'center' })] : [];
        change([markErrorLine(errorLine), ...shown]);
    }, [errorLine]);

    return h('div', {
        ref: host, onKeyDown,
        style: { flex: 1, minHeight: 0, width: '100%', display: 'flex', overflow: 'hidden' },
    });
}
