// Settings → Analysis: a second-level list of the analysis windows on the left,
// that window's display fields on the right.
//
// Every setting belongs to the window that shows it, including its own spectral
// range: two windows can sit on different bands, which is the point. Values
// apply when a window next opens.
import { ANALYSIS_WINDOW_IDS } from '../../../../constants/analysisDefaults.js';
import { resolveAnalysisSettings } from '../../../../utils/analysisSettings.js';
import { useAnalysisSettings } from '../../../../state/AnalysisSettingsContext.js';
import { WindowFields } from './WindowFields.js';
import { buttonStyle, hintStyle } from '../ui.js';

const { createElement: h, useState } = React;

const itemStyle = (c, active) => ({
  display: 'block', width: '100%', textAlign: 'left',
  padding: '6px 10px', marginBottom: '1px',
  backgroundColor: active ? c.bg : 'transparent',
  color: active ? c.text : c.textDim,
  border: 'none', borderLeft: `2px solid ${active ? c.accent : 'transparent'}`,
  borderRadius: '4px', cursor: 'pointer',
  fontSize: '12px', fontWeight: active ? '600' : '400',
});

export const AnalysisPane = ({ c, t }) => {
  const [windowId, setWindowId] = useState(ANALYSIS_WINDOW_IDS[0]);
  const settings = useAnalysisSettings();
  const stored = settings?.stored;
  const resolved = resolveAnalysisSettings(windowId, stored);
  const overridden = !!settings?.isOverridden(windowId);
  const anySaved = !!settings?.hasAnyOverride;

  const onChange = (section, key, value) => settings?.setField(windowId, section, key, value);
  const resetWindow = () => settings?.resetWindow(windowId);
  const resetAll = () => settings?.resetAll();

  return h('div', { style: { display: 'flex', gap: '16px', height: '100%' } },
    h('div', { style: { width: '190px', flexShrink: 0, overflow: 'auto' } },
      ANALYSIS_WINDOW_IDS.map(id => h('button', {
        key: id,
        onClick: () => setWindowId(id),
        style: itemStyle(c, id === windowId),
      },
        t.settings.analysis.windows[id],
        settings?.isOverridden(id) && h('span', {
          title: t.settings.analysis.modified,
          style: { color: c.accent, marginLeft: '4px' },
        }, '•')
      ))
    ),
    h('div', { style: { flex: 1, minWidth: 0, overflow: 'auto', paddingRight: '4px' } },
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px' } },
        h('div', { style: { fontSize: '14px', fontWeight: '600', color: c.text } },
          t.settings.analysis.windows[windowId]),
        h('div', { style: { flex: 1 } }),
        h('button', {
          onClick: resetWindow,
          disabled: !overridden,
          style: { ...buttonStyle(c), opacity: overridden ? 1 : 0.45, cursor: overridden ? 'pointer' : 'default' },
        }, t.settings.analysis.resetWindow)
      ),
      h('span', { style: hintStyle(c) }, t.settings.analysis.hint),
      settings?.saveError && h('div', {
        role: 'alert',
        style: {
          fontSize: '12px', color: c.error, border: `1px solid ${c.error}`,
          borderRadius: '6px', padding: '8px', margin: '8px 0',
        },
      }, settings.saveError === 'unavailable'
        ? t.settings.analysis.saveUnavailable
        : t.settings.analysis.saveFailed(settings.saveError)),
      h(WindowFields, { windowId, resolved, onChange, c, t }),
      h('div', { style: { marginTop: '20px', paddingTop: '12px', borderTop: `1px solid ${c.border}` } },
        h('button', {
          onClick: resetAll,
          disabled: !anySaved,
          style: {
            ...buttonStyle(c),
            opacity: anySaved ? 1 : 0.45,
            cursor: anySaved ? 'pointer' : 'default',
          },
        }, t.settings.analysis.resetAll)
      )
    )
  );
};
