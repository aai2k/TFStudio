import assert from 'node:assert/strict';
import {
    attachTabWheelScroll,
    scrollOverflowingTabs,
} from '../src/components/docking/tabWheel.js';

let registered = null;
let removed = null;
const bar = {
    scrollWidth: 300,
    clientWidth: 100,
    scrollLeft: 20,
    addEventListener: (type, handler, options) => { registered = { type, handler, options }; },
    removeEventListener: (type, handler) => { removed = { type, handler }; },
};

const detach = attachTabWheelScroll(bar);
assert.equal(registered.type, 'wheel');
assert.deepEqual(registered.options, { passive: false });

let prevented = 0;
registered.handler({ deltaY: 15, preventDefault: () => prevented++ });
assert.equal(bar.scrollLeft, 35);
assert.equal(prevented, 1);

scrollOverflowingTabs(bar, { deltaY: 0, preventDefault: () => prevented++ });
assert.equal(bar.scrollLeft, 35);
assert.equal(prevented, 1);

bar.scrollWidth = bar.clientWidth;
scrollOverflowingTabs(bar, { deltaY: 20, preventDefault: () => prevented++ });
assert.equal(bar.scrollLeft, 35);
assert.equal(prevented, 1);

detach();
assert.equal(removed.type, 'wheel');
assert.equal(removed.handler, registered.handler);

console.log('PASS: tab_group_wheel');
