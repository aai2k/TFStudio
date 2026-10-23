// Preferences → Automation: the switch that has TFStudio listen for programs
// from its start, as Interactive on the Optimization tab does from its click
// but with each program asked about before it comes in, and whether it
// listens; and the Python the Script Console runs Python scripts in, with
// which one that is or what is missing.
import { Checkbox } from '../../ui/Checkbox.js';
import { pythonStatus } from '../../windows/optimization/scriptConsole/scriptLanguage.js';
import { Row, buttonStyle, hintStyle, selectStyle } from './ui.js';

const { createElement: h, useEffect, useState } = React;

// The line under the switch while it is on: listening, or why it could not
// start. Nothing while the app is still starting.
function statusText(status, t) {
  if (status?.open) return t.settings.liveBridgeOn;
  return status?.error ? t.settings.liveBridgeFailed(status.error) : null;
}

// What the main process finds for the Python path `path` (findPython), or
// null until it answers.
function useFoundPython(path) {
  const [found, setFound] = useState(null);
  useEffect(() => {
    if (!window.electronAPI?.findPython) return undefined;
    let current = true;
    setFound(null);
    window.electronAPI.findPython(path).then(answer => { if (current) setFound(answer); }, () => {});
    return () => { current = false; };
  }, [path]);
  return found;
}

// The Python path, typed and taken when the field is left or Enter is
// pressed, or chosen with Browse. Empty, the console looks for one on PATH.
function PythonRow({ pythonPath = '', setPythonPath, c, t }) {
  const [draft, setDraft] = useState(pythonPath);
  useEffect(() => { setDraft(pythonPath); }, [pythonPath]);
  const found = useFoundPython(pythonPath);
  const status = found && pythonStatus(t.scriptConsole, found);
  const take = (value) => {
    const next = value.trim();
    setDraft(next);
    if (next !== pythonPath && setPythonPath) setPythonPath(next);
  };
  const browse = async () => {
    const chosen = await window.electronAPI?.choosePythonFile?.();
    if (chosen?.path) take(chosen.path);
  };
  return h(Row, { c, label: t.settings.pythonPath, hint: t.settings.pythonPathHint, wide: true },
    h('div', { style: { display: 'flex', gap: '6px' } },
      h('input', {
        type: 'text', value: draft, spellCheck: false,
        placeholder: t.settings.pythonPathPlaceholder, 'aria-label': t.settings.pythonPath,
        onChange: (e) => setDraft(e.target.value),
        onBlur: (e) => take(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') take(e.currentTarget.value); },
        style: { ...selectStyle(c), flex: 1, minWidth: 0 },
      }),
      h('button', { type: 'button', onClick: browse, title: t.settings.pythonBrowseTip, style: buttonStyle(c) },
        t.settings.folders.browse)
    ),
    status && h('span', {
      role: 'status', style: { ...hintStyle(c), color: status.type === 'error' ? c.error : c.textDim },
    }, status.text)
  );
}

export const AutomationPane = ({ liveBridge, setLiveBridge, liveBridgeStatus, pythonPath, setPythonPath, c, t }) => {
  const status = liveBridge ? statusText(liveBridgeStatus, t) : null;
  return h('div', null,
    h(Row, { c, label: t.settings.liveBridge, hint: t.settings.liveBridgeHint },
      h(Checkbox, {
        c,
        checked: !!liveBridge,
        onChange: (e) => setLiveBridge && setLiveBridge(e.target.checked),
      }),
      status && h('span', { style: hintStyle(c), role: 'status' }, status)
    ),
    h(PythonRow, { pythonPath, setPythonPath, c, t })
  );
};
