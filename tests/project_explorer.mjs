import {
  filterExplorerFolders,
  sortExplorerItems,
  updateExplorerItemMtime,
} from '../src/components/panels/projectExplorerModel.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { shimBrowserGlobals, loadApp, makeLocale, makeTheme } from './_uiShim.mjs';

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

const folders = [
  {
    id: 'visible', name: 'Visible coatings', expanded: true,
    items: [
      { id: 'b', name: 'Filter 10', mtime: 100 },
      { id: 'a', name: 'Filter 2', mtime: 200 },
    ],
  },
  {
    id: 'ir', name: 'Infrared', expanded: false,
    items: [{ id: 'c', name: 'Germanium AR', mtime: 150 }],
  },
];

const nameAsc = sortExplorerItems(folders[0].items, 'name-asc');
ok(nameAsc.map((item) => item.id).join() === 'a,b', 'name sorting is numeric and ascending');
ok(sortExplorerItems(folders[0].items, 'name-desc').map((item) => item.id).join() === 'b,a',
  'name descending reverses the order');
ok(sortExplorerItems(folders[0].items, 'date-new').map((item) => item.id).join() === 'a,b',
  'newest date sorting uses mtime');
ok(sortExplorerItems(folders[0].items, 'date-old').map((item) => item.id).join() === 'b,a',
  'oldest date sorting uses mtime');
ok(folders[0].items[0].id === 'b', 'sorting does not mutate the folder data');

const fileMatch = filterExplorerFolders(folders, 'germanium');
ok(fileMatch.length === 1 && fileMatch[0].id === 'ir' && fileMatch[0].items[0].id === 'c',
  'search keeps a matching design and its parent project');
ok(fileMatch[0].expanded === true && folders[1].expanded === false,
  'search reveals matches without mutating project expansion state');

const folderMatch = filterExplorerFolders(folders, 'VISIBLE');
ok(folderMatch.length === 1 && folderMatch[0].items.length === 2,
  'a case-insensitive project match keeps all of its designs');
ok(filterExplorerFolders(folders, 'missing').length === 0, 'search excludes non-matches');
ok(filterExplorerFolders(folders, '  ') === folders, 'blank search preserves the original tree');

const saved = updateExplorerItemMtime(folders, 'b', 300);
ok(saved[0].items.find((item) => item.id === 'b').mtime === 300,
  'successful save timestamp updates the matching explorer item');
ok(saved[1] === folders[1], 'save timestamp preserves unaffected projects');
ok(sortExplorerItems(saved[0].items, 'date-new')[0].id === 'b',
  'a just-saved design immediately moves under newest-first sorting');
ok(sortExplorerItems(saved[0].items, 'date-old').at(-1).id === 'b',
  'a just-saved design immediately moves under oldest-first sorting');

const tiedDates = [{ id: 'z', name: 'Zulu', mtime: 1 }, { id: 'a', name: 'Alpha', mtime: 1 }];
ok(sortExplorerItems(tiedDates, 'date-new')[0].id === 'a',
  'equal save dates use a stable ascending name order');

shimBrowserGlobals();
await loadApp();
const { ProjectExplorer } = await import('../src/components/panels/ProjectExplorer.js');
const noop = () => {};
const markup = renderToStaticMarkup(React.createElement(ProjectExplorer, {
  folders,
  selectedFolder: folders[0],
  selectedItem: null,
  selectedItems: [],
  handleItemClick: noop,
  setSelectedFolder: noop,
  toggleFolderExpanded: noop,
  addItem: noop,
  duplicateItem: noop,
  removeSelectedItems: noop,
  removeItem: noop,
  setInputDialog: noop,
  addFolder: noop,
  renameFolder: noop,
  renameItem: noop,
  removeFolder: noop,
  dirtyDesigns: {},
  c: makeTheme(),
  t: makeLocale(),
  onOpenDesign: noop,
}));
ok(markup.includes('placeholder="Search"'), 'explorer renders the localized search field');
ok(markup.includes('aria-label="Hide Explorer"'), 'explorer renders an accessible hide control');

console.log(`project_explorer: ${passed} passed`);
