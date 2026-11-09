/**
 * The Agent Skill folders in skills/: each SKILL.md's frontmatter as the Agent
 * Skills specification takes it (https://agentskills.io/specification), so a
 * client that reads skills loads it, and the folder shipped with the app,
 * where the MCP server's designMethod tool reads it (src/main/serverEntry.js).
 *
 *   1. The frontmatter is YAML with name and description; name is 1 to 64
 *      lowercase letters, digits and single hyphens, neither first nor last,
 *      and the folder's own name; description is 1 to 1024 characters;
 *      compatibility, when there, 1 to 500; no field the specification lacks.
 *   2. The installer ships the skills folder as a resource, and the MCP
 *      server's skill is there.
 *
 * Run: node tests/agent_skill.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = path.join(ROOT, 'skills');
const FIELDS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const length = (text, max) => typeof text === 'string' && text.length >= 1 && text.length <= max;

// ── 1. The frontmatter ─────────────────────────────────────────────────────
const folders = fs.readdirSync(SKILLS, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
ok('there is a skill', folders.length > 0);
for (const folder of folders) {
    const text = fs.readFileSync(path.join(SKILLS, folder, 'SKILL.md'), 'utf8');
    const head = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
    ok(`${folder}: SKILL.md opens with frontmatter`, head !== null);
    let fields = null;
    try { fields = yaml.load(head?.[1] ?? ''); } catch (err) { ok(`${folder}: the frontmatter reads as YAML`, false, err.message); }
    if (!fields) continue;
    ok(`${folder}: name is 1 to 64 lowercase letters, digits and single hyphens`, length(fields.name, 64) && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(fields.name), fields.name);
    ok(`${folder}: name is the folder's name`, fields.name === folder, fields.name);
    ok(`${folder}: description is 1 to 1024 characters`, length(fields.description, 1024), String(fields.description?.length));
    ok(`${folder}: compatibility, when there, is 1 to 500 characters`, !('compatibility' in fields) || length(fields.compatibility, 500));
    ok(`${folder}: no field the specification lacks`, Object.keys(fields).every(key => FIELDS.includes(key)), Object.keys(fields).join(','));
    ok(`${folder}: there is a body after the frontmatter`, text.slice(head[0].length).trim().length > 0);
}

// ── 2. Shipped with the app ────────────────────────────────────────────────
const { build } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
ok('the installer ships the skills folder as a resource', build.extraResources.some(entry => entry.from === 'skills' && entry.to === 'skills'));
ok('the MCP server\'s skill is in it', fs.existsSync(path.join(SKILLS, 'coating-design', 'SKILL.md')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
