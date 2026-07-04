// Parse src/constants/locales.js into an editable model and write surgical edits back.
//
// Why surgical (offset-based) edits instead of re-serialising the whole object?
//   locales.js contains 150+ FUNCTION-valued entries (e.g. `(n) => `Trial — ${n}``)
//   plus section comments and hand-tuned formatting. Re-emitting from a plain
//   object would destroy all of that. Instead we locate each value node's exact
//   [start,end) byte range via the AST and splice replacements into the original
//   source, touching nothing else.

import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';

const PARSE_OPTS = { ecmaVersion: 'latest', sourceType: 'module' };

function keyName(prop) {
  if (prop.computed) return null;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal') return String(prop.key.value);
  return null;
}

// Recursively collect leaf values and object nodes for one language object.
//   leaves:  pathStr -> { kind:'string'|'expr', text, start, end }
//   objects: pathStr -> ObjectExpression node   ('' = root)
function walk(objExpr, code, prefix, leaves, objects) {
  objects.set(prefix, objExpr);
  for (const prop of objExpr.properties) {
    if (prop.type !== 'Property') continue;
    const k = keyName(prop);
    if (k == null) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    const v = prop.value;
    if (v.type === 'ObjectExpression') {
      walk(v, code, path, leaves, objects);
    } else if (v.type === 'Literal' && typeof v.value === 'string') {
      leaves.set(path, { kind: 'string', text: v.value, start: v.start, end: v.end });
    } else {
      // template literal, arrow function, number, etc. — edit as raw source.
      leaves.set(path, { kind: 'expr', text: code.slice(v.start, v.end), start: v.start, end: v.end });
    }
  }
}

// Locate the `const <name> = { ... }` ObjectExpression for each top-level const.
function collectTopObjects(ast) {
  const out = {};
  for (const node of ast.body) {
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (decl && decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        if (d.id.type === 'Identifier' && d.init && d.init.type === 'ObjectExpression') {
          out[d.id.name] = d.init;
        }
      }
    }
  }
  return out;
}

// Read `const locales = { en, ru }` -> { en:'en', ru:'ru' } (code -> identifier name).
function collectRegistry(ast) {
  const map = {};
  for (const node of ast.body) {
    if (node.type !== 'VariableDeclaration') continue;
    for (const d of node.declarations) {
      if (d.id.type === 'Identifier' && d.id.name === 'locales' &&
          d.init && d.init.type === 'ObjectExpression') {
        for (const prop of d.init.properties) {
          const k = keyName(prop);
          if (k && prop.value.type === 'Identifier') map[k] = prop.value.name;
        }
      }
    }
  }
  return map;
}

// Read `availableLocales = [{ code, name }, ...]` for display names + ordering.
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

export function buildModel(filePath) {
  const code = readFileSync(filePath, 'utf8');
  const ast = acorn.parse(code, PARSE_OPTS);

  const registry = collectRegistry(ast);          // code -> ident name
  const topObjects = collectTopObjects(ast);       // ident name -> ObjectExpression
  let available = collectAvailable(ast);           // [{code,name}]
  if (available.length === 0) {
    available = Object.keys(registry).map((c) => ({ code: c, name: c }));
  }

  // Per-language leaf + object maps.
  const langs = {};   // code -> { leaves:Map, objects:Map }
  for (const { code: lc } of available) {
    const ident = registry[lc] || lc;
    const objExpr = topObjects[ident];
    if (!objExpr) continue;
    const leaves = new Map();
    const objects = new Map();
    walk(objExpr, code, '', leaves, objects);
    langs[lc] = { leaves, objects };
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
    code,
    rows,
    languages: available,
    _internal: { langs, registry, available },
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

// Build `{ ... }` text for a nested tree of new keys.
//   node: { __leaf:{kind,value} } | { children:{ key: node } }
function emitTree(node, indent) {
  if (node.__leaf) return serializeValue(node.__leaf.kind, node.__leaf.value);
  const childIndent = indent + '  ';
  const parts = Object.entries(node.children).map(
    ([k, child]) => `${childIndent}${keyText(k)}: ${emitTree(child, childIndent)}`
  );
  return `{\n${parts.join(',\n')}\n${indent}}`;
}

// Apply edits and return the new source text.
//   edits: [{ path, lang, kind:'string'|'expr', value }]
export function applyEdits(model, edits) {
  const { code } = model;
  const { langs } = model._internal;

  const replacements = []; // { start, end, text }
  const insertsByLang = {}; // lang -> [{ path, kind, value }]

  for (const e of edits) {
    const L = langs[e.lang];
    if (!L) throw new Error(`Unknown language: ${e.lang}`);
    const leaf = L.leaves.get(e.path);
    if (leaf) {
      replacements.push({ start: leaf.start, end: leaf.end, text: serializeValue(e.kind, e.value) });
    } else {
      (insertsByLang[e.lang] ||= []).push({ path: e.path, kind: e.kind, value: e.value });
    }
  }

  // Insertions: group by the deepest EXISTING ancestor object so multiple new
  // keys sharing a new parent branch are emitted as one nested object.
  for (const [lang, items] of Object.entries(insertsByLang)) {
    const L = langs[lang];
    const groups = new Map(); // ancestorPath -> { node, tree:{children} }
    for (const it of items) {
      const segs = it.path.split('.');
      let ancestorPath = '';
      let i = 0;
      // Find deepest existing ancestor object.
      for (; i < segs.length - 1; i++) {
        const cand = segs.slice(0, i + 1).join('.');
        if (L.objects.has(cand)) ancestorPath = cand; else break;
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
      const braceIndent = lineIndent(code, node.start);
      const childIndent = braceIndent + '  ';
      const props = Object.entries(tree.children).map(
        ([k, child]) => `${keyText(k)}: ${emitTree(child, childIndent)}`
      );
      const hasProps = node.properties.length > 0;
      if (hasProps) {
        const last = node.properties[node.properties.length - 1];
        // Insert after the last property (and after a trailing comma if any).
        const pos = last.end;
        const text = `,\n${childIndent}${props.join(`,\n${childIndent}`)}`;
        replacements.push({ start: pos, end: pos, text });
      } else {
        const pos = node.start + 1; // just after `{`
        const text = `\n${childIndent}${props.join(`,\n${childIndent}`)}\n${braceIndent}`;
        replacements.push({ start: pos, end: pos, text });
      }
    }
  }

  // Apply from highest offset to lowest so earlier offsets stay valid.
  replacements.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = code;
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

// Validate that the produced source still parses.
export function validateSource(src) {
  acorn.parse(src, PARSE_OPTS);
  return true;
}
