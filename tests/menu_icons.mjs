/**
 * Menu icons are Tabler outline icons, named by each entry and drawn by the menu.
 *
 * The Project Explorer drew icons of its own at 14 px, the Design Editor's
 * layer menu used text characters (+, ⎘, ⇤, ⇥, ×) and the Material Editor's
 * menus Unicode glyphs, so no two menus looked alike and the glyphs were too
 * small to read.
 *
 *   1. The context menu draws a named icon as a 16 px outline in the accent
 *      colour, a dangerous entry's in the error colour, and a menu of plain
 *      labels still opens with no icon column.
 *   2. Every icon a menu of the app names is one tablerIcons.js draws.
 *
 * Run: node tests/menu_icons.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { ContextMenu } = await import('../src/components/ui/ContextMenu.js');
const { tablerIcon } = await import('../src/components/ui/tablerIcons.js');

const c = makeTheme();
const render = items => renderToStaticMarkup(React.createElement(ContextMenu, { x: 0, y: 0, items, c, onClose() {} }));

// ── 1. What the context menu draws ───────────────────────────────────────────
{
    const html = render([
        { id: 'open', label: 'Open', icon: 'folder-open' },
        { separator: true },
        { id: 'delete', label: 'Delete', icon: 'trash', danger: true },
    ]);
    assert.equal((html.match(/<svg width="16" height="16" viewBox="0 0 24 24"/g) || []).length, 2,
        'each named icon is drawn as a 16 px outline');
    assert.ok(html.includes(`color:${c.accent}`), 'in the accent colour');
    assert.ok(html.includes(`color:${c.error}`), 'and a dangerous entry\'s in the error colour');
}
{
    const html = render([{ id: 'copy', label: 'Copy' }, { id: 'paste', label: 'Paste' }]);
    assert.ok(!html.includes('<svg') && !html.includes('width:16px'), 'a menu of plain labels has no icon column');
}

// ── 2. Every icon the app's menus name exists ────────────────────────────────
const menuSources = [
    'src/components/panels/ProjectExplorer.js',
    'src/components/windows/design/designEditor/LayerList.js',
    'src/components/windows/design/materialEditor/materialEditorLeftPanel.js',
];
let named = 0;
for (const path of menuSources) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    for (const [, value] of source.matchAll(/\bicon:\s*([^,}\n]+)/g)) {
        const name = value.trim().match(/^'([a-z0-9-]+)'$/)?.[1];
        assert.ok(name, `${path}: an entry's icon is the name of a Tabler icon, not ${value.trim()}`);
        assert.ok(tablerIcon(name), `${path}: the icon '${name}' is one tablerIcons.js draws`);
        named += 1;
    }
}
assert.ok(named >= 20, 'the menus were found and read');

console.log(`menu_icons: passed (${named} entries)`);
