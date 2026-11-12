/**
 * The results table of a window that draws every environment at once, All in
 * its Environment droplist (environmentChoice.js): each environment's rows in
 * turn, after a column naming the environment.
 *
 * `tables` are `{ env, table }`, `env` the environment, `{ number, label }`,
 * and `table` the window's own `{ columns, rows }` for it, null where there is
 * nothing to list; the columns are the same in every environment. `label`
 * heads the new column, t.environments.environment. Null when no environment
 * has a table.
 */
export function environmentTable(tables, label) {
    const listed = tables.filter(({ table }) => table);
    if (!listed.length) return null;
    return {
        columns: [{ key: 'env', label, align: 'left' }, ...listed[0].table.columns],
        rows: listed.flatMap(({ env, table }) => table.rows.map(row => ({ env: env.label, ...row }))),
    };
}
