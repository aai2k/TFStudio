#!/usr/bin/env node
// Post-build pass: rewrite absolute /... asset paths to relative paths so the
// dist/ folder works when opened via file:// without a web server.
// Run automatically after "astro build" via the "build" npm script.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, 'dist');

// Returns the relative prefix string needed to reach distDir from filePath's dir.
// e.g. depth-2 file → '../../'
function relPrefix(filePath) {
  const rel = relative(distDir, dirname(filePath));
  if (!rel) return './';
  const depth = rel.split(/[\\/]/).filter(Boolean).length;
  return '../'.repeat(depth);
}

let count = 0;

function processHtml(filePath) {
  const original = readFileSync(filePath, 'utf-8');
  const pfx = relPrefix(filePath);

  // Replace attribute values that start with a single /  (not // or http)
  // Handles: href="/...", src="/...", action="/...", content="/..."
  let out = original.replace(
    /(\b(?:href|src|action|content)=["'])\/(?!\/)/g,
    `$1${pfx}`,
  );

  // url('/...') and url("/...") in inline style / script blocks
  out = out.replace(/\burl\('\/(?!\/)/g, `url('${pfx}`);
  out = out.replace(/\burl\("\/(?!\/)/g, `url("${pfx}`);

  if (out !== original) {
    writeFileSync(filePath, out, 'utf-8');
    count++;
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (full.endsWith('.html')) {
      processHtml(full);
    }
  }
}

walk(distDir);
console.log(`docs rebase: rewrote ${count} HTML file(s) in dist/ for file:// compatibility`);
