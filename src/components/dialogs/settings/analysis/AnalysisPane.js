// Settings → Analysis: a second-level list of the analysis windows on the left,
// that window's display fields on the right.
//
// Values apply when a window next opens. The shared entry holds the spectral
// range, which seeds the session-wide evaluation parameters at startup.
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

  const onChange = (section, key, value) => settings?.setField(windowId, section, key, value);

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
          onClick: () => settings?.resetWindow(windowId),
          disabled: !overridden,
          style: { ...buttonStyle(c), opacity: overridden ? 1 : 0.45, cursor: overridden ? 'pointer' : 'default' },
        }, t.settings.analysis.resetWindow)
      ),
      h('span', { style: hintStyle(c) },
        windowId === 'shared' ? t.settings.analysis.sharedHint : t.settings.analysis.hint),
      h(WindowFields, { windowId, resolved, onChange, c, t }),
      h('div', { style: { marginTop: '20px', paddingTop: '12px', borderTop: `1px solid ${c.border}` } },
        h('button', {
          onClick: () => settings?.resetAll(),
          disabled: !settings?.hasAnyOverride,
          style: {
            ...buttonStyle(c),
            opacity: settings?.hasAnyOverride ? 1 : 0.45,
            cursor: settings?.hasAnyOverride ? 'pointer' : 'default',
          },
        }, t.settings.analysis.resetAll)
      )
    )
  );
};
