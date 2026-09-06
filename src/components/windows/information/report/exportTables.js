/**
 * Every table in a report document as tab-separated text, one blank line
 * between tables and each preceded by the heading of the block it belongs to,
 * ready to paste into a spreadsheet.
 */

const stripTags = html => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'')
    .replace(/\s+/g, ' ').trim();

function tableText(tableHtml) {
    const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
    return rows.map(([, row]) =>
        [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(([, cell]) => stripTags(cell)).join('\t'))
        .join('\n');
}

export function tablesAsText(html) {
    const blocks = [...html.matchAll(/<section[^>]*data-block="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)];
    const out = [];
    for (const [, , body] of blocks) {
        const heading = body.match(/<h2>([\s\S]*?)<\/h2>/);
        const title = heading ? stripTags(heading[1].replace(/<span class="tf-sub">[\s\S]*?<\/span>/, '')) : '';
        for (const [table] of body.matchAll(/<table[\s\S]*?<\/table>/g)) {
            out.push((title ? title + '\n' : '') + tableText(table));
        }
    }
    return out.join('\n\n');
}
