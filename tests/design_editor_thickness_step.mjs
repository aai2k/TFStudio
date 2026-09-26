/**
 * Design Editor thickness stepping: the step each column takes per arrow click
 * or wheel tick, how a step lands on one or several layers, and how steps are
 * grouped so one Ctrl+Z takes back a whole burst.
 *
 * Run: node tests/design_editor_thickness_step.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals, loadApp } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { nmToUnit, MAX_THICKNESS_NM } = await import(
    '../src/components/windows/design/designEditor/units.js');
const { thicknessStep, stepLayerThicknesses, createStepBursts } = await import(
    '../src/components/windows/design/designEditor/thicknessStep.js');
const { wheelTicks, wheelTravel } = await import(
    '../src/components/windows/design/designEditor/ThicknessSpin.js');

const close = (actual, expected, message) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} vs ${expected}`);

// ── Step sizes ────────────────────────────────────────────────────────────────
const table = {
    nm:   [1, 10, 0.1],
    OT:   [1, 10, 0.1],
    QWOT: [0.1, 1, 0.01],
    FWOT: [0.025, 0.25, 0.0025],
};
for (const [unit, [plain, shift, ctrl]] of Object.entries(table)) {
    close(thicknessStep(unit), plain, `${unit} plain step`);
    close(thicknessStep(unit, { shiftKey: true }), shift, `${unit} Shift step`);
    close(thicknessStep(unit, { ctrlKey: true }), ctrl, `${unit} Ctrl step`);
}

// QWOT = 4·n·d/λ₀ and FWOT = n·d/λ₀ (Macleod §3.1): one QW step and one FW step
// are the same optical thickness, so both columns' arrows move a layer alike.
const refLambda = 550;
close(thicknessStep('QWOT') * refLambda / 4, thicknessStep('FWOT') * refLambda,
    'a QW step and an FW step are the same n·d');

// The Ctrl step still shows at the precision each column displays.
assert.ok(thicknessStep('nm', { ctrlKey: true }) >= 0.01, 'nm shows 2 decimals');
assert.ok(thicknessStep('FWOT', { ctrlKey: true }) >= 0.0001, 'FW shows 4 decimals');

// ── One layer ─────────────────────────────────────────────────────────────────
const stepBy = (layers, ids, amount, unit) => stepLayerThicknesses(layers, ids, { amount, unit, refLambda });
const layer = (id, material, thickness, locked = false) => ({ id, material, thickness, locked });
const stack = [
    layer('h', 'builtin:TiO2', 50),
    layer('l', 'builtin:SiO2', 90),
    layer('k', 'builtin:SiO2', 40, true),
];

let next = stepBy(stack, ['l'], 1, 'nm');
assert.equal(next[1].thickness, 91, 'one nm step adds 1 nm');
assert.equal(next[0], stack[0], 'untouched layers keep their object');
assert.equal(stack[1].thickness, 90, 'the input stack is not mutated');

next = stepBy(stack, ['l'], -0.1, 'QWOT');
close(nmToUnit(next[1].thickness, 'builtin:SiO2', refLambda, 'QWOT'),
    nmToUnit(90, 'builtin:SiO2', refLambda, 'QWOT') - 0.1, 'a QW step moves QW by exactly the step');

assert.equal(stepBy(stack, ['k'], 1, 'nm'), null, 'a locked layer does not step');
assert.equal(stepBy(stack, ['missing'], 1, 'nm'), null, 'an unknown id changes nothing');

// ── Several layers in an optical unit ─────────────────────────────────────────
next = stepBy(stack, ['h', 'l', 'k'], 1, 'OT');
// OT of a 1 nm layer is the index at λ₀.
const nH = nmToUnit(1, 'builtin:TiO2', refLambda, 'OT');
const nL = nmToUnit(1, 'builtin:SiO2', refLambda, 'OT');
close(next[0].thickness - 50, 1 / nH, 'TiO2 moves 1 nm of its own optical thickness');
close(next[1].thickness - 90, 1 / nL, 'SiO2 moves 1 nm of its own optical thickness');
assert.ok(next[1].thickness - 90 > next[0].thickness - 50, 'the lower index layer moves further in d');
assert.equal(next[2].thickness, 40, 'a locked layer in the selection holds');

// ── Limits ────────────────────────────────────────────────────────────────────
next = stepBy([layer('a', 'builtin:SiO2', 0.5)], ['a'], -1, 'nm');
assert.equal(next[0].thickness, 0, 'a step down stops at zero');
assert.equal(stepBy(next, ['a'], -1, 'nm'), null, 'at zero a step down changes nothing');
next = stepBy([layer('a', 'builtin:SiO2', MAX_THICKNESS_NM - 3)], ['a'], 10, 'nm');
assert.equal(next[0].thickness, MAX_THICKNESS_NM, 'a step up stops at the typed-entry maximum');

const unresolved = [layer('u', 'no-such-material', 100)];
assert.equal(stepBy(unresolved, ['u'], 1, 'QWOT'), null,
    'an unresolved material has no QW to step');
assert.equal(stepBy(unresolved, ['u'], 1, 'nm')[0].thickness, 101,
    'an unresolved material still steps in nm');

// ── Wheel ─────────────────────────────────────────────────────────────────────
const wheel = (deltaY, extra = {}) => ({ deltaY, deltaX: 0, deltaMode: 0, shiftKey: false, ...extra });
assert.equal(wheelTravel(wheel(-100)), 100, 'wheel away is positive travel');
assert.equal(wheelTravel(wheel(100)), -100, 'wheel toward is negative travel');
assert.equal(wheelTravel(wheel(0, { deltaX: -100, shiftKey: true })), 100,
    'Shift+wheel, delivered sideways, still counts');
assert.equal(wheelTravel(wheel(0, { deltaX: 100 })), 0, 'a sideways scroll without Shift does not');
assert.equal(wheelTravel(wheel(-3, { deltaMode: 1 })), 100, 'three lines are one notch');

// Feed a run of travels through wheelTicks and total the steps.
const ticksFor = travels => {
    let carry = 0;
    let steps = 0;
    for (const travel of travels) {
        const result = wheelTicks(travel, carry);
        carry = result.carry;
        steps += result.ticks;
    }
    return steps;
};
assert.equal(ticksFor([100, 100, 100]), 3, 'one step per notch');
assert.equal(ticksFor([-100, -100]), -2, 'toward the user steps down');
assert.equal(ticksFor([90.9, 125, 110]), 3, 'a notch measured a little off 100 px still counts once');
assert.equal(ticksFor([300]), 3, 'three notches in one event are three steps');
assert.equal(ticksFor(Array(9).fill(100 / 3)), 3, 'a notch sent in three pieces is one step');
assert.equal(ticksFor(Array(30).fill(4)), 1, 'a touchpad swipe of 120 px is one step, not thirty');
assert.equal(ticksFor([60, -60]), 0, 'travel carried one way is dropped when the wheel turns back');

// ── Undo bursts ───────────────────────────────────────────────────────────────
// The table shows `shown`; each write is what the design store would then show.
const bursts = createStepBursts(1000);
const plusOne = base => stepBy(base, ['l'], 1, 'nm');
let shown = stack;
const tick = (now, key = 'front|nm|l', build = plusOne) => {
    const result = bursts.step(key, shown, now, build);
    if (result) shown = result.next;
    return result;
};

assert.equal(tick(0).commit, true, 'the first step of a burst is an undoable edit');
assert.equal(tick(100).commit, false, 'the next step within the gap is transient');
assert.equal(tick(900).commit, false, 'a step within the gap of the last one continues the burst');
assert.equal(tick(1500).commit, false, 'the gap runs from the last step, not from the first');
assert.equal(shown[1].thickness, 94, 'every step in the burst lands');
assert.equal(tick(2600).commit, true, 'after a pause the next step starts a new burst');
assert.equal(tick(2700, 'front|OT|l').commit, true, 'another column is another burst');

// A render that has not caught up with the last write still builds on it.
const lagging = shown;
tick(2800, 'front|OT|l');
const behind = bursts.step('front|OT|l', lagging, 2900, plusOne);
assert.equal(behind.commit, false, 'a table one write behind continues the burst');
assert.equal(behind.next[1].thickness, shown[1].thickness + 1, 'and builds on the latest write, not the stale one');
shown = behind.next;

// Ctrl+Z inside the gap brings back the stack from before the burst, which the
// burst never wrote, so the next step is a new undoable edit from there.
const beforeBurst = stack;
shown = beforeBurst;
const afterUndo = tick(3000, 'front|OT|l');
assert.equal(afterUndo.commit, true, 'a step after an undo is a new undoable edit');
assert.equal(afterUndo.next[1].thickness, 91, 'and starts from the undone stack');

// A first step that moves nothing does not use up the burst's undoable write.
shown = [layer('z', 'builtin:SiO2', 0)];
const down = base => stepBy(base, ['z'], -1, 'nm');
const up = base => stepBy(base, ['z'], 1, 'nm');
assert.equal(tick(5000, 'front|nm|z', down), null, 'a step past zero writes nothing');
assert.equal(tick(5100, 'front|nm|z', up).commit, true, 'the first real write is the undoable one');

console.log('PASS design_editor_thickness_step');
