/**
 * The wizard layer-tab strip on a long design: 200 buttons must all stay
 * reachable, so the strip is height-capped and scrolls instead of overflowing
 * the page, and the selected button is kept scrolled into view.
 *
 * Run: node tests/wizard_layer_tabs.mjs
 */

// wizardShared.js reads React from the global scope at import time.
const effects = [];
globalThis.React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef: () => ({ current: null }),
    useEffect: (fn, deps) => { effects.push({ fn, deps }); },
    useState: (v) => [v, () => {}],
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
};

const { LayerTabs } = await import('../src/components/windows/simulation/wizardShared.js');

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };

const c = { accent: '#3aafff', border: '#3a3a3a', bg: '#1e1e1e', text: '#ccc' };
const strip = LayerTabs({ n: 200, current: 137, onSelect: () => {}, c, label: 'Layer' });

const buttons = strip.children[0];
ok(Array.isArray(buttons) && buttons.length === 200, 'renders one button per layer');

const style = strip.props.style;
ok(style.overflowY === 'auto', 'the strip scrolls when its rows overflow');
ok(Number.isFinite(style.maxHeight) && style.maxHeight <= 150,
   `the strip is height-capped (${style.maxHeight}px), not as tall as 200 wrapped buttons`);

const active = buttons[136];
ok(active.props.ref != null && buttons.every((b, i) => i === 136 || b.props.ref == null),
   'exactly the selected button carries the scroll-into-view ref');
ok(effects.length > 0 && effects.at(-1).deps.includes(137),
   'an effect keeps the selection in view as it changes');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
