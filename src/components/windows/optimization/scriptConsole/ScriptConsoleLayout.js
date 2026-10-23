import { SplitPane } from '../../../docking/SplitPane.js';
import { ActionButton, ChoiceGroup } from '../../analysis/chrome/controls.js';
import { AnalysisWindow, ControlRow, PlotArea } from '../../analysis/chrome/layout.js';
import { ReportAndNotices } from '../../dataExchange/chrome/actionStatus.js';
import { appShortcutFor } from '../../../../utils/misc/appShortcuts.js';
import { CodeEditor } from './codeEditor.js';
import { LANGUAGES } from './scriptLanguage.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

const SPLIT_CHILDREN = [{ id: 'script-editor' }, { id: 'script-output' }];
const TEXT_FONT = 'ui-monospace, Consolas, monospace';
// How near the end of the output counts as at the end, in px: a wheel step
// seldom lands on the last pixel.
const AT_END_SLACK_PX = 4;

// The app's chords the editor keeps for itself while it has focus: Ctrl+Z and
// Ctrl+Y undo and redo the typing rather than the design, Ctrl+S, Ctrl+O and
// Ctrl+N do not save, open or add a design behind the window, and Ctrl+G finds
// the next match of a search rather than opening the games. The app's
// listener is on the document, which an event stopped here never reaches.
const EDITOR_KEEPS = new Set(['undo', 'redo', 'save', 'open', 'new', 'games']);

/** The editor's keys: Ctrl+Enter runs the script; the app's chords above stay in the editor. */
export function editorKeyDown(event, onRun) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        onRun();
        return;
    }
    if (EDITOR_KEEPS.has(appShortcutFor(event))) event.stopPropagation();
}

const textBoxStyle = (c, whiteSpace) => ({
    flex: 1, width: '100%', minHeight: 0, resize: 'none', boxSizing: 'border-box',
    background: c.bg, color: c.text, border: 'none', outline: 'none', padding: 8,
    fontFamily: TEXT_FONT, fontSize: 12, lineHeight: 1.45, whiteSpace, tabSize: 4,
});

const runButtonStyle = (c, color, disabled) => ({
    height: 28, padding: '0 14px', fontSize: 12, border: 'none', borderRadius: 6,
    background: disabled ? c.border : color, color: disabled ? c.textDim : '#fff',
    cursor: disabled ? 'default' : 'pointer', fontWeight: 600, fontFamily: 'inherit', opacity: disabled ? 0.5 : 1,
});

const sideTextStyle = (c) => ({
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: c.textDim, fontSize: 11, fontVariantNumeric: 'tabular-nums',
});

// Run while no script runs, Stop while one does. An empty editor has nothing to run.
function RunButton({ c, z, running, empty, onRun, onStop }) {
    if (running) {
        return h('button', { type: 'button', onClick: onStop, style: runButtonStyle(c, c.error, false) }, `■ ${z.stop}`);
    }
    return h('button', {
        type: 'button', title: z.runTip, disabled: empty, onClick: onRun, style: runButtonStyle(c, c.success, empty),
    }, `▶ ${z.run}`);
}

function Controls({ c, t, z, session, running, runStatus, onRun, onStop, onLanguage, onOpen, onSave, status }) {
    const empty = !session.text.trim();
    return h(ControlRow, { c },
        h(RunButton, { c, z, running, empty, onRun, onStop }),
        h(ChoiceGroup, {
            c, ariaLabel: z.languageLabel, activeId: session.language, onSelect: onLanguage,
            items: LANGUAGES.map(id => ({ id, label: z.languages[id] })),
        }),
        h(ActionButton, { c, label: z.openBtn, title: z.openTip, onClick: onOpen }),
        h(ActionButton, { c, label: z.saveBtn, title: z.saveTip, onClick: onSave, disabled: !session.text }),
        session.fileName && h('span', { title: session.filePath || session.fileName, style: sideTextStyle(c) }, session.fileName),
        runStatus && h('span', { role: 'status', style: sideTextStyle(c) }, runStatus),
        h(ReportAndNotices, { c, t, status, notices: [] }),
    );
}

// The editor's words in a language and a script language, one object for each
// pair, so the editor takes them again only when either changes.
const editorWords = new WeakMap();
function wordsFor(z, language) {
    if (!editorWords.has(z)) editorWords.set(z, {});
    const byLanguage = editorWords.get(z);
    byLanguage[language] ??= { label: z.editorLabel, placeholder: z.editorPlaceholder[language], phrases: z.editorPhrases };
    return byLanguage[language];
}

// The editor, in the script's language and the app's words.
function EditorBox({ c, z, session, onChange, onRun }) {
    return h(CodeEditor, {
        c, text: session.text, language: session.language, errorLine: session.errorLine,
        words: wordsFor(z, session.language), onChange,
        onKeyDown: event => editorKeyDown(event, onRun),
    });
}

/**
 * The output's text: the lines kept (src/scripts/outputBounds.js), under a
 * first line saying how many earlier ones are not shown when there are any,
 * and with a cut line ending in how much of it is not shown.
 */
export function outputText(z, lines, hidden) {
    const shown = lines.map(line => (typeof line === 'string' ? line : `${line.text}${z.lineCut(line.cut)}`));
    return (hidden ? [z.outputHidden(hidden), ...shown] : shown).join('\n');
}

// What the script printed. It follows new output while it is scrolled to the
// end, and stays where it is while the user reads further up.
function OutputBox({ c, z, lines, hidden }) {
    const box = useRef(null);
    const atEnd = useRef(true);
    const output = useMemo(() => outputText(z, lines, hidden), [z, lines, hidden]);
    useEffect(() => {
        if (box.current && atEnd.current) box.current.scrollTop = box.current.scrollHeight;
    }, [output]);
    return h('textarea', {
        ref: box, value: output, readOnly: true, spellCheck: false,
        placeholder: z.outputPlaceholder, 'aria-label': z.outputLabel,
        onScroll: (event) => {
            const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
            atEnd.current = scrollTop + clientHeight >= scrollHeight - AT_END_SLACK_PX;
        },
        style: textBoxStyle(c, 'pre-wrap'),
    });
}

/**
 * The control row over the editor and the output, which share the window
 * across a divider. `onTextChange(text)` takes each edit made in the editor.
 */
export function ScriptConsoleLayout(props) {
    const { c, z, session, setField, onTextChange, onRun } = props;
    return h(AnalysisWindow, { c },
        h(Controls, props),
        h(PlotArea, null,
            h(SplitPane, {
                c,
                node: { direction: 'v', sizes: session.splitSizes, children: SPLIT_CHILDREN },
                onSizesChange: sizes => setField('splitSizes', sizes),
            },
                h(EditorBox, { c, z, session, onChange: onTextChange, onRun }),
                h(OutputBox, { c, z, lines: session.output, hidden: session.outputHidden }),
            ),
        ),
    );
}
