// The coating design method, for agents whose client reads no Agent Skills:
// the text of skills/coating-design/SKILL.md, the skill folder that clients
// which do read skills load on their own.

import fs from 'node:fs';
import { object } from './schemaParts.js';

// The skill file's body, without the frontmatter only a skill loader reads.
const body = text => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();

/** The designMethod tool, reading `skillPath`, the SKILL.md file, on each call. */
export function methodTools({ skillPath }) {
    return [
        {
            name: 'designMethod', title: 'How to design a coating',
            description: 'The order to design a coating in with these tools, from the requirement to a saved file: the materials, a starting stack, the merit function, refinement and synthesis, a stack a coater can make, the specification and the yield. Read it before a design job.',
            inputSchema: object({}),
            run: () => ({ method: body(fs.readFileSync(skillPath, 'utf8')) }),
        },
    ];
}
