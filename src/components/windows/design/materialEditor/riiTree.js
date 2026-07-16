/**
 * RIIBrowser — collapsible shelf → book → page tree (browse mode).
 *
 * Each function takes the browser's flat state object `s` (from useRIIBrowser)
 * alongside the tree node it renders.
 */

const { createElement: h } = React;

const rowBase = {
    cursor: 'pointer', userSelect: 'none',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

export function shelfRow(shelf, s) {
    const { c, expandedShelves, toggleShelf } = s;
    const open = expandedShelves.has(shelf.shelf);
    const active = open;
    return h('div', { key: shelf.shelf },
        h('div', {
            onClick: () => toggleShelf(shelf.shelf),
            style: {
                ...rowBase, padding: '5px 10px',
                display: 'flex', alignItems: 'center', gap: 6,
                backgroundColor: active ? c.accent + '18' : 'transparent',
                borderBottom: `1px solid ${c.border}44`,
                fontSize: 12, fontWeight: 700,
                color: active ? c.accent : c.text,
            },
        },
            h('span', { style: { fontSize: 10, width: 10, flexShrink: 0, color: c.textDim } }, open ? '▾' : '▸'),
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, shelf.name),
            h('span', { style: { marginLeft: 'auto', fontSize: 10, color: c.textDim, flexShrink: 0 } },
                shelf.books.length)
        ),
        open && shelf.books.map(book => bookRow(shelf, book, s))
    );
}

function bookRow(shelf, book, s) {
    const { c, expandedBooks, toggleBook } = s;
    const key = shelf.shelf + '/' + book.book;
    const open = expandedBooks.has(key);
    const active = open;
    return h('div', { key },
        h('div', {
            onClick: () => toggleBook(key),
            style: {
                ...rowBase, padding: '4px 10px 4px 22px',
                display: 'flex', alignItems: 'center', gap: 6,
                backgroundColor: active ? c.accent + '12' : 'transparent',
                borderBottom: `1px solid ${c.border}33`,
                fontSize: 12, fontWeight: 600,
                color: active ? c.accent : c.text,
            },
        },
            h('span', { style: { fontSize: 10, width: 10, flexShrink: 0, color: c.textDim } }, open ? '▾' : '▸'),
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, book.name),
            h('span', { style: { marginLeft: 'auto', fontSize: 10, color: c.textDim, flexShrink: 0 } },
                book.pages.length)
        ),
        open && book.pages.map(page => pageRow(shelf, book, page, s))
    );
}

function pageRow(shelf, book, page, s) {
    const { c, selected, handleSelectResult } = s;
    const isActive = selected?.dataPath === page.dataPath;
    const result = {
        shelf: shelf.shelf, shelfName: shelf.name,
        book: book.book,   bookName: book.name,
        page: page.page,   pageName: page.name,
        dataPath: page.dataPath,
    };
    return h('div', {
        key: page.dataPath,
        onClick: () => handleSelectResult(result),
        style: {
            ...rowBase, padding: '3px 10px 3px 36px',
            display: 'flex', alignItems: 'center',
            borderBottom: `1px solid ${c.border}22`,
            backgroundColor: isActive ? c.accent + '22' : 'transparent',
            borderLeft: `2px solid ${isActive ? c.accent : 'transparent'}`,
            fontSize: 11,
            color: isActive ? c.accent : c.text,
        },
    },
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, page.name)
    );
}
