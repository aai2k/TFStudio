import { DataTablePanel } from '../../../ui/DataTablePanel.js';
import { buildProfileTable } from './profileViewModel.js';

const { createElement: h } = React;

export function EFieldTable({ profile, pol, c, t }) {
    const table = buildProfileTable(profile, pol);
    return table ? h(DataTablePanel, { columns: table.columns, rows: table.rows, c, t }) : null;
}
