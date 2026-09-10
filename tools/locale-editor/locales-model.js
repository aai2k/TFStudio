// Parse src/constants/locales/ into an editable model and write surgical edits back.
//
// One file per language, each `export default { ... }`, plus an index.js that
// carries `availableLocales` (the display names and the column order). A file is
// parsed on its own, so an edit to one language rewrites only that language's
// file and leaves the others byte-identical.
//
// Why surgical (offset-based) edits instead of re-serialising the whole object?
//   A locale file contains 280+ FUNCTION-valued entries (e.g. `(n) => `Trial ${n}``)
//   plus section comments and hand-tuned formatting. Re-emitting from a plain
//   object would destroy all of that. Instead we locate each value node's exact
//   [start,end) byte range via the AST and splice replacements into the original
//   source, touching nothing else.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as acorn from 'acorn';

const PARSE_OPTS = { ecmaVersion: 'latest', sourceType: 'module' };

function keyName(prop) {
  if (prop.computed) return null;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal') return String(prop.key.value);
  return null;
}

// Record one value node: recurse into a container, otherwise store a leaf.
function visit(node, code, path, leaves, objects) {
  if (node.type === 'ObjectExpression') {
    walk(node, code, path, leaves, objects);
  } else if (node.type === 'ArrayExpression') {
    walkArray(node, code, path, leaves, objects);
  } else if (node.type === 'Literal' && typeof node.value === 'string') {
    leaves.set(path, { kind: 'string', text: node.value, start: node.start, end: node.end });
  } else {
    // template literal, arrow function, number, etc. Edited as raw source.
    leaves.set(path, { kind: 'expr', text: code.slice(node.start, node.end), start: node.start, end: node.end });
  }
}

// Recursively collect leaf values and container nodes for one language object.
//   leaves:     pathStr -> { kind:'string'|'expr', text, start, end }
//   containers: pathStr -> ObjectExpression | ArrayExpression   ('' = root)
//
// Arrays are walked by index (the tutorial lesson step lists), so each string
// inside one is its own editable row rather than the whole array arriving as a
// single blob of JavaScript nobody translating the app should have to touch.
function walk(objExpr, code, prefix, leaves, objects) {
  objects.set(prefix, objExpr);
  for (const prop of objExpr.properties) {
    if (prop.type !== 'Property') continue;
    const k = keyName(prop);
    if (k == null) continue;
    visit(prop.value, code, prefix ? `${prefix}.${k}` : k, leaves, objects);
  }
}

function walkArray(arrExpr, code, prefix, leaves, objects) {
  objects.set(prefix, arrExpr);
  arrExpr.elements.forEach((el, i) => {
    if (el) visit(el, code, `${prefix}.${i}`, leaves, objects);
  });
}

// The `export default { ... }` object of one locale file.
function defaultExportObject(ast) {
  for (const node of ast.body) {
    if (node.type === 'ExportDefaultDeclaration' && node.declaration.type === 'ObjectExpression') {
      return node.declaration;
    }
  }
  return null;
}

// Read `availableLocales = [{ code, name }, ...]` from index.js for the display
// names and the column order.
function collectAvailable(ast) {
  const out = [];
  for (const node of ast.body) {
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (!decl || decl.type !== 'VariableDeclaration') continue;
    for (const d of decl.declarations) {
      if (d.id.type === 'Identifier' && d.id.name === 'availableLocales' &&
          d.init && d.init.type === 'ArrayExpression') {
        for (const el of d.init.elements) {
          if (el && el.type === 'ObjectExpression') {
            const o = {};
            for (const prop of el.properties) {
              const k = keyName(prop);
              if (k && prop.value.type === 'Literal') o[k] = prop.value.value;
            }
            if (o.code) out.push({ code: o.code, name: o.name || o.code });
          }
        }
      }
    }
  }
  return out;
}

export function buildModel(dir) {
  const indexPath = join(dir, 'index.js');
  if (!existsSync(indexPath)) throw new Error(`No index.js in ${dir}`);
  const available = collectAvailable(acorn.parse(readFileSync(indexPath, 'utf8'), PARSE_OPTS));
  if (available.length === 0) throw new Error(`No availableLocales in ${indexPath}`);

  // Per-language source, leaf and object maps, each from its own file.
  const langs = {};   // code -> { path, code, leaves:Map, objects:Map }
  for (const { code: lc } of available) {
    const path = join(dir, `${lc}.js`);
    if (!existsSync(path)) continue;
    const source = readFileSync(path, 'utf8');
    const objExpr = defaultExportObject(acorn.parse(source, PARSE_OPTS));
    if (!objExpr) throw new Error(`${lc}.js has no "export default { ... }"`);
    const leaves = new Map();
    const objects = new Map();
    walk(objExpr, source, '', leaves, objects);
    langs[lc] = { path, code: source, leaves, objects };
  }

  // Union of all paths across languages, in first-seen (source) order.
  const order = [];
  const seen = new Set();
  for (const { code: lc } of available) {
    const L = langs[lc];
    if (!L) continue;
    for (const path of L.leaves.keys()) {
      if (!seen.has(path)) { seen.add(path); order.push(path); }
    }
  }

  const rows = order.map((path) => {
    const cells = {};
    let kind = 'string';
    for (const { code: lc } of available) {
      const leaf = langs[lc]?.leaves.get(path) || null;
      if (leaf) {
        if (leaf.kind === 'expr') kind = 'expr';
        cells[lc] = { present: true, kind: leaf.kind, text: leaf.text };
      } else {
        cells[lc] = { present: false, kind: null, text: '' };
      }
    }
    return { path, namespace: path.split('.')[0], kind, cells };
  });

  return {
    dir,
    rows,
    languages: available,
    _internal: { langs, available },
  };
}

// ── Writing ──────────────────────────────────────────────────────────────────

function quoteString(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '')}'`;
}

function keyText(k) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : `'${k.replace(/'/g, "\\'")}'`;
}

function serializeValue(kind, value) {
  return kind === 'expr' ? String(value) : quoteString(value);
}

// Indentation of the source line containing `pos`.
function lineIndent(code, pos) {
  let nl = code.lastIndexOf('\n', pos - 1);
  let i = nl + 1;
  let ws = '';
  while (i < code.length && (code[i] === ' ' || code[i] === '\t')) { ws += code[i]; i++; }
  return ws;
}

// A branch whose keys are exactly 0..n-1 came from an array and is emitted as one.
function isArrayBranch(children) {
  const keys = Object.keys(children);
  return keys.length > 0 && keys.every((k, i) => k === String(i));
}

// Build `{ ... }` or `[ ... ]` text for a nested tree of new keys.
//   node: { __leaf:{kind,value} } | { children:{ key: node } }
function emitTree(node, indent) {
  if (node.__leaf) return serializeValue(node.__leaf.kind, node.__leaf.value);
  const childIndent = indent + '  ';
  if (isArrayBranch(node.children)) {
    const items = Object.values(node.children).map((child) => `${childIndent}${emitTree(child, childIndent)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  const parts = Object.entries(node.children).map(
    ([k, child]) => `${childIndent}${keyText(k)}: ${emitTree(child, childIndent)}`
  );
  return `{\n${parts.join(',\n')}\n${indent}}`;
}

// Existing members of a container node, whichever kind it is.
const membersOf = (node) => (node.type === 'ArrayExpression' ? node.elements : node.properties).filter(Boolean);

// Apply edits and return the new source of every language an edit touched:
//   edits:   [{ path, lang, kind:'string'|'expr', value }]
//   returns: [{ lang, path, source }]  — languages with no edits are absent.
export function applyEdits(model, edits) {
  const { langs } = model._internal;

  const byLang = {};   // lang -> { replacements:[], inserts:[] }
  const bucket = (lang) => (byLang[lang] ||= { replacements: [], inserts: [] });

  for (const e of edits) {
    const L = langs[e.lang];
    if (!L) throw new Error(`Unknown language: ${e.lang}`);
    const leaf = L.leaves.get(e.path);
    if (leaf) {
      bucket(e.lang).replacements.push({
        start: leaf.start, end: leaf.end, text: serializeValue(e.kind, e.value),
      });
    } else {
      bucket(e.lang).inserts.push({ path: e.path, kind: e.kind, value: e.value });
    }
  }

  const written = [];
  for (const [lang, work] of Object.entries(byLang)) {
    const L = langs[lang];
    const { replacements, inserts } = work;

    // Insertions: group by the deepest EXISTING ancestor object so multiple new
    // keys sharing a new parent branch are emitted as one nested object.
    const groups = new Map(); // ancestorPath -> { node, tree:{children} }
    for (const it of inserts) {
      const segs = it.path.split('.');
      let ancestorPath = '';
      // Find deepest existing ancestor object. A parent that exists as a LEAF in
      // this language (a string where English has a block) is not a container to
      // insert into: writing the child anyway would emit a second property with
      // the parent's name further up and silently shadow the existing one.
      for (let i = 0; i < segs.length - 1; i++) {
        const cand = segs.slice(0, i + 1).join('.');
        if (L.objects.has(cand)) { ancestorPath = cand; continue; }
        if (L.leaves.has(cand)) {
          throw new Error(
            `Cannot add ${it.path} to ${lang}: ${cand} is a value there, not a block. ` +
            `Fix ${cand} first (npm run i18n:scan reports it as a type mismatch).`);
        }
        break;
      }
      const node = L.objects.get(ancestorPath);
      if (!node) throw new Error(`No insertion point for ${it.path} in ${lang}`);
      const rel = segs.slice(ancestorPath ? ancestorPath.split('.').length : 0);
      let g = groups.get(ancestorPath);
      if (!g) { g = { node, tree: { children: {} } }; groups.set(ancestorPath, g); }
      // Build nested branch.
      let cur = g.tree;
      for (let j = 0; j < rel.length; j++) {
        const key = rel[j];
        if (j === rel.length - 1) {
          cur.children[key] = { __leaf: { kind: it.kind, value: it.value } };
        } else {
          if (!cur.children[key] || !cur.children[key].children) {
            cur.children[key] = { children: {} };
          }
          cur = cur.children[key];
        }
      }
    }

    for (const { node, tree } of groups.values()) {
      const braceIndent = lineIndent(L.code, node.start);
      const childIndent = braceIndent + '  ';
      const intoArray = node.type === 'ArrayExpression';
      const props = Object.entries(tree.children).map(
        ([k, child]) => (intoArray ? emitTree(child, childIndent) : `${keyText(k)}: ${emitTree(child, childIndent)}`)
      );
      const members = membersOf(node);
      if (members.length > 0) {
        // Insert after the last member (and after a trailing comma if any).
        const pos = members[members.length - 1].end;
        replacements.push({ start: pos, end: pos, text: `,\n${childIndent}${props.join(`,\n${childIndent}`)}` });
      } else {
        const pos = node.start + 1; // just after `{` or `[`
        replacements.push({ start: pos, end: pos, text: `\n${childIndent}${props.join(`,\n${childIndent}`)}\n${braceIndent}` });
      }
    }

    // Apply from highest offset to lowest so earlier offsets stay valid.
    replacements.sort((a, b) => b.start - a.start || b.end - a.end);
    let out = L.code;
    for (const r of replacements) {
      out = out.slice(0, r.start) + r.text + out.slice(r.end);
    }
    written.push({ lang, path: L.path, source: out });
  }

  return written;
}

// Validate that the produced source still parses.
export function validateSource(src) {
  acorn.parse(src, PARSE_OPTS);
  return true;
}
