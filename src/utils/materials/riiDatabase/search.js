/**
 * Catalog text search.
 */

/**
 * Search catalog for books/pages matching query string.
 * Returns array of { shelf, shelfName, book, bookName, page, pageName, dataPath }.
 */
export function searchCatalog(catalog, query) {
    if (!query || !catalog) return [];
    const q = query.toLowerCase().trim();
    const results = [];
    for (const shelf of catalog) {
        for (const book of shelf.books) {
            const bookMatch = book.name.toLowerCase().includes(q) || book.book.toLowerCase().includes(q);
            for (const page of book.pages) {
                if (bookMatch || page.name.toLowerCase().includes(q)) {
                    results.push({
                        shelf: shelf.shelf, shelfName: shelf.name,
                        book: book.book,   bookName: book.name,
                        page: page.page,   pageName: page.name,
                        dataPath: page.dataPath,
                    });
                }
            }
        }
    }
    return results.slice(0, 200);  // limit
}
