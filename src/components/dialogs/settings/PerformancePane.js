// Preferences → Updates: update checks.
import { UpdateCheckRow } from './UpdateCheckRow.js';

const { createElement: h } = React;

export const PerformancePane = ({ updateCheckEnabled, setUpdateCheckEnabled, c, t }) =>
  h('div', null,
    h(UpdateCheckRow, { updateCheckEnabled, setUpdateCheckEnabled, c, t })
  );
