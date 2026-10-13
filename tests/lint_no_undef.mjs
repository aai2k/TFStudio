/**
 * Every name used in src/ and web/ is defined, imported, or a known global,
 * and no comment there is a TODO or FIXME note.
 *
 * A name that is none of these passes the bundle and every test that does not
 * reach it, then throws a ReferenceError when a user does. The rule set is
 * eslint.config.mjs at the repo root: no-undef and no-warning-comments.
 */

import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const eslint = new ESLint({ cwd: ROOT });
const results = await eslint.lintFiles(['src', 'web']);

let problems = 0;
for (const r of results) {
    for (const m of r.messages) {
        problems++;
        console.log(`${relative(ROOT, r.filePath)}:${m.line}:${m.column}  ${m.message}`);
    }
}

console.log(`${results.length} files checked, ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
