#!/usr/bin/env node
// Bulk EN→RU translator for the Starlight docs site.
//
// - Walks docs-site/src/content/docs/ (excluding ru/) for .md and .mdx files.
// - For each EN file, computes the mirror RU path under .../docs/ru/.
// - Sends the file to Claude Sonnet 4.6 with a strict, cached system prompt
//   (TRANSLATION_GUIDE.md + optional anchor RU files) and writes the result.
//
// Usage:
//   node translate-docs.mjs                 # translate all missing RU files
//   node translate-docs.mjs --force         # re-translate even if RU exists
//   node translate-docs.mjs --only=needle   # translate files whose path contains "needle"
//   node translate-docs.mjs --dry-run       # list what would be translated, do nothing
//   node translate-docs.mjs --model=haiku   # use claude-haiku-4-5 instead of sonnet-4-6
//
// Requires: ANTHROPIC_API_KEY env var, "@anthropic-ai/sdk" installed
//   npm install --save-dev @anthropic-ai/sdk

import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, readdir, mkdir, access } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = join(__dirname, 'src', 'content', 'docs');
const RU_ROOT   = join(DOCS_ROOT, 'ru');
const GUIDE     = join(__dirname, 'TRANSLATION_GUIDE.md');

// Gold-standard RU files used as style anchors. Add finalised RU pages here
// after the user has hand-reviewed them; the LLM imitates their voice.
// Keep this list SHORT (1–3 files) so the cached system prompt stays cheap.
const ANCHORS = [
  join(RU_ROOT, 'design', 'design-editor.md'),
];

const MODELS = {
  sonnet: 'claude-sonnet-4-6',
  haiku:  'claude-haiku-4-5-20251001',
  opus:   'claude-opus-4-7',
};

// CLI flags
const argv = process.argv.slice(2);
const has  = (f) => argv.includes(f);
const opt  = (prefix) => {
  const a = argv.find((x) => x.startsWith(prefix));
  return a ? a.slice(prefix.length) : null;
};
const FORCE     = has('--force');
const DRY       = has('--dry-run');
const ONLY      = opt('--only=');
const MODEL_KEY = opt('--model=') || 'sonnet';
const MODEL     = MODELS[MODEL_KEY] || MODEL_KEY;
const MAX_INFLIGHT = parseInt(opt('--concurrency=') || '5', 10);

const client = new Anthropic();

async function fileExists(p) { try { await access(p); return true; } catch { return false; } }

async function findEnFiles() {
  const out = [];
  async function walk(dir) {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (full === RU_ROOT) continue; // never recurse into ru/
        await walk(full);
        continue;
      }
      if (!/\.(md|mdx)$/.test(ent.name)) continue;
      // Skip working artefacts: anything with "copy" or "MY VERSION" in the name
      if (/\bcopy\b/i.test(ent.name) || /MY VERSION/i.test(ent.name)) continue;
      out.push(full);
    }
  }
  await walk(DOCS_ROOT);
  return out.sort();
}

const ruPathFor = (enPath) => join(RU_ROOT, relative(DOCS_ROOT, enPath));

async function buildSystemPrompt() {
  const guide = await readFile(GUIDE, 'utf-8');

  let anchorBlock = '(no anchor RU files configured yet — follow the GUIDE strictly)';
  if (ANCHORS.length) {
    const parts = [];
    for (const p of ANCHORS) {
      if (!(await fileExists(p))) continue;
      const content = await readFile(p, 'utf-8');
      parts.push(`### Anchor: ${relative(__dirname, p)}\n\n${content}`);
    }
    if (parts.length) anchorBlock = parts.join('\n\n---\n\n');
  }

  return `You are a professional technical translator. Source language: English. Target language: Russian. Domain: optical thin-film coating design (TFStudio, an Electron app for designing dielectric coatings).

# YOUR TASK
Translate the user-provided Markdown or MDX file from English to Russian, obeying every rule below.

# GLOSSARY AND STYLE GUIDE
${guide}

# ANCHOR RU TRANSLATIONS (style/voice reference — imitate these)
${anchorBlock}

# OUTPUT FORMAT
- Output the translated file content and NOTHING else.
- Do NOT prepend "Here is the translation:" or any meta-commentary.
- Do NOT wrap the entire output in a Markdown code fence.
- Start with the YAML frontmatter (\`---\`) if the source has one, and end with the last line of the document.
- Translate ONLY the values of \`title:\` and \`description:\` inside the frontmatter. Every other frontmatter key and value must be byte-identical to the source.

# FINAL REMINDER
If you do not know the exact idiomatic Russian term, write a plain-prose description and put the original English term in parentheses, e.g. "TMM только задней стороны (back_only)". Never invent Russian words. Confirmed bad coinages: Редактор дизайна, Входы, Однопокрытие, запертый.`;
}

async function translateOne(enPath, ruPath, system) {
  const en = await readFile(enPath, 'utf-8');
  const rel = relative(__dirname, enPath);

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content:
`Translate the following file to Russian per the rules and glossary in the system prompt.

Source file: ${rel}

----- FILE BEGIN -----
${en}
----- FILE END -----`,
      },
    ],
  });

  let out = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

  // Defensive: strip an accidental outer code fence if the model added one
  out = out.replace(/^```(?:markdown|md|mdx)?\s*\r?\n/, '').replace(/\r?\n```\s*$/, '');
  // Defensive: drop a leading meta line like "Here is the translation:" if present
  if (!/^---/.test(out) && /^[^\n]{0,80}(translation|перевод)[^\n]{0,40}\n/i.test(out)) {
    out = out.replace(/^[^\n]+\n+/, '');
  }

  await mkdir(dirname(ruPath), { recursive: true });
  await writeFile(ruPath, out, 'utf-8');

  return resp.usage || {};
}

async function pool(items, limit, fn) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY in your environment.');
    process.exit(1);
  }
  if (!Object.values(MODELS).includes(MODEL)) {
    console.error(`Unknown --model value. Use one of: ${Object.keys(MODELS).join(', ')}, or pass a full model id.`);
    process.exit(1);
  }

  const all = await findEnFiles();
  let work = all;
  if (ONLY) work = work.filter((f) => f.includes(ONLY));
  if (!FORCE) {
    const filtered = [];
    for (const f of work) if (!(await fileExists(ruPathFor(f)))) filtered.push(f);
    work = filtered;
  }

  console.log(`Model:              ${MODEL}`);
  console.log(`English files:      ${all.length}`);
  console.log(`Selected to run:    ${work.length}${FORCE ? ' (force re-translate)' : ' (skipping existing RU files)'}`);
  console.log(`Concurrency:        ${MAX_INFLIGHT}`);
  if (DRY) {
    work.forEach((f) => console.log('  -', relative(__dirname, f)));
    return;
  }
  if (!work.length) { console.log('Nothing to do.'); return; }

  const system = await buildSystemPrompt();

  let totIn = 0, totOut = 0, totCacheRead = 0, totCacheWrite = 0;
  let okCount = 0, failCount = 0;

  await pool(work, MAX_INFLIGHT, async (enPath) => {
    const ruPath = ruPathFor(enPath);
    const t0 = Date.now();
    try {
      const u = await translateOne(enPath, ruPath, system);
      const ms = Date.now() - t0;
      totIn        += u.input_tokens || 0;
      totOut       += u.output_tokens || 0;
      totCacheRead += u.cache_read_input_tokens || 0;
      totCacheWrite+= u.cache_creation_input_tokens || 0;
      okCount++;
      console.log(
        `OK  ${relative(__dirname, enPath)} -> ${relative(__dirname, ruPath)}  ` +
        `[${(ms/1000).toFixed(1)}s in=${u.input_tokens||0} cacheR=${u.cache_read_input_tokens||0} cacheW=${u.cache_creation_input_tokens||0} out=${u.output_tokens||0}]`
      );
    } catch (err) {
      failCount++;
      console.error(`FAIL ${relative(__dirname, enPath)}: ${err.message}`);
    }
  });

  // Rough cost (Sonnet 4.6 list price; adjust if --model=haiku/opus)
  const PRICE = MODEL === MODELS.opus
    ? { in: 15, out: 75,  cacheR: 1.5,  cacheW: 18.75 }
    : MODEL === MODELS.haiku
    ? { in: 1,  out: 5,   cacheR: 0.1,  cacheW: 1.25 }
    : { in: 3,  out: 15,  cacheR: 0.3,  cacheW: 3.75 }; // sonnet
  const cost =
    (totIn        * PRICE.in     +
     totOut       * PRICE.out    +
     totCacheRead * PRICE.cacheR +
     totCacheWrite* PRICE.cacheW) / 1e6;

  console.log('');
  console.log(`Done. OK=${okCount} FAIL=${failCount}`);
  console.log(`Tokens: input=${totIn} output=${totOut} cache_read=${totCacheRead} cache_write=${totCacheWrite}`);
  console.log(`Approx cost (${MODEL_KEY} list price): $${cost.toFixed(3)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
