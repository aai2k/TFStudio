import {
  DesignSummaryOptions, OpticalEvalOptions, ColorEvalOptions,
  EllipsometryOptions, RiProfileOptions, EfieldOptions, NotesOptions,
} from './OptionBlocks.js';

const { createElement: h } = React;

// Fixed rendering order — independent of the user's section reorder in step 2.
const OPTION_BLOCKS = [
  ['design-summary', DesignSummaryOptions],
  ['optical-eval', OpticalEvalOptions],
  ['color-eval', ColorEvalOptions],
  ['ellipsometry', EllipsometryOptions],
  ['ri-profile', RiProfileOptions],
  ['efield', EfieldOptions],
  ['notes', NotesOptions],
];

export function StepOptions({ g, c, W }) {
  const { sections, perSection, setOpt, sectionTitleOf } = g;
  const isOn = (id) => !!sections.find(s => s.id === id)?.on;
  const active = OPTION_BLOCKS.filter(([id]) => isOn(id));

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', maxHeight: 390, paddingRight: 4 } },
    active.map(([id, Block]) => h(Block, {
      key: id, c, W, title: sectionTitleOf(id),
      opt: perSection[id] || {},
      setOpt: (patch) => setOpt(id, patch),
    })),
    active.length === 0 && h('div', { style: { color: c.textDim, fontSize: 13 } }, W.noOptions || 'Selected sections need no extra options.'));
}
