/**
 * H7 regression — restored docking layout must be re-keyed so its node/tab ids
 * cannot collide with ids the current session generates.
 *
 * The bug: module-level seq counters (`uid`→'n1','n2'… and `newTabId`→'t1'…)
 * reset on each launch, but a saved layout restored from localStorage still
 * carries ids minted by the PRIOR session. A node created after restore then
 * reuses an id already in the tree, so addTab/setSizes/setActiveTab hit BOTH
 * matching nodes (and React sees duplicate keys).
 *
 * treeUtils is pure (no React), so we can drive the collision and the fix
 * directly. We can't reset the module counters mid-process, so we simulate a
 * "prior session" tree with hand-written ids that the live counters are
 * GUARANTEED to re-emit ('n1','t1'), then show:
 *   (a) without re-keying, addTab targeting that id appends to two groups;
 *   (b) rekeyTree() makes every id unique AND advances the counters past them,
 *       so a freshly-minted id matches exactly one node.
 *
 * Run: node tests/docking_tree_rekey.mjs
 */

import { uid, newTabId, rekeyTree, addTab, findNode } from '../src/components/docking/treeUtils.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } else { console.log('  ✓', msg); } };

const countNodes = (node, id, acc = { n: 0 }) => {
    if (!node) return acc.n;
    if (node.id === id) acc.n++;
    (node.children || []).forEach(c => countNodes(c, id, acc));
    return acc.n;
};
const allIds = (node, out = []) => {
    if (!node) return out;
    out.push(node.id);
    (node.tabs || []).forEach(t => out.push(t.id));
    (node.children || []).forEach(c => allIds(c, out));
    return out;
};

// ── A "prior session" tree using ids the live counters WILL re-emit ───────────
const priorTree = {
    type: 'split', id: 'n1', direction: 'h',
    sizes: [50, 50],
    children: [
        { type: 'tabs', id: 'n2', activeTab: 0, tabs: [{ id: 't1', title: 'A', toolId: 'a' }] },
        { type: 'tabs', id: 'n3', activeTab: 0, tabs: [{ id: 't2', title: 'B', toolId: 'b' }] },
    ],
};

// (a) Demonstrate the latent collision: a brand-new group id collides with the
// restored 'n2'/'n3' namespace. Build a tree containing a DUPLICATE id and show
// addTab corrupts both.
{
    const dup = {
        type: 'split', id: 'root', direction: 'h', sizes: [50, 50],
        children: [
            { type: 'tabs', id: 'dupe', activeTab: 0, tabs: [] },
            { type: 'tabs', id: 'dupe', activeTab: 0, tabs: [] },
        ],
    };
    const after = addTab(dup, 'dupe', { id: 'x', title: 'X', toolId: 'x' });
    const hits = after.children.filter(g => g.tabs.length === 1).length;
    ok(hits === 2, 'collision baseline: addTab on a duplicated id appends to BOTH groups');
}

// (b) rekeyTree assigns unique ids and advances the counters past them.
{
    const rekeyed = rekeyTree(priorTree);
    const ids = allIds(rekeyed);
    ok(new Set(ids).size === ids.length, 'rekeyTree: every id in the restored tree is unique');

    // No restored id should survive verbatim where the counter would re-emit it.
    const flat = allIds(rekeyed);
    ok(!flat.includes('t1') || flat.indexOf('t1') === flat.lastIndexOf('t1'),
        'rekeyTree: no duplicate tab id remains');

    // A freshly-minted node id must match exactly ONE node (it is beyond the
    // tree's id range, so it is brand new — count 0 in the tree).
    const freshNode = uid();
    const freshTab  = newTabId();
    ok(countNodes(rekeyed, freshNode) === 0, 'rekeyTree: a newly-minted node id is not already in the tree');
    ok(!allIds(rekeyed).includes(freshTab), 'rekeyTree: a newly-minted tab id is not already in the tree');

    // And structure/content is preserved (same node count, same toolIds).
    const tools = [];
    const walk = (n) => { (n.tabs || []).forEach(t => tools.push(t.toolId)); (n.children || []).forEach(walk); };
    walk(rekeyed);
    ok(tools.join(',') === 'a,b', 'rekeyTree: tab content (toolIds) preserved in order');
}

if (fails) { console.error(`\n${fails} test(s) FAILED`); process.exit(1); }
console.log('\nAll tests passed.');
