/**
 * Tolerant JSONC pre-parse for VS Code theme files: strip `//` line comments,
 * `/* block *​/` comments, and trailing commas while respecting string literals
 * (comment-like sequences inside a string are preserved verbatim). The result is
 * plain JSON ready for JSON.parse.
 *
 * Implemented as a character state machine over four states (outside / in-string
 * / in-line-comment / in-block-comment); each handler returns the index to
 * resume at (advancing past a consumed second character) and `emit`s any output.
 */

// State inside a string literal: copy the char; a backslash copies the next char
// too (escape); the matching quote ends the string.
function inString(s, ch, next, i, emit) {
  emit(ch);
  if (ch === '\\') { emit(next); return i + 1; }
  if (ch === s.strCh) s.inStr = false;
  return i;
}

// Outside any string/comment: open a string, a `//` line comment, or a `/*`
// block comment, else copy the char.
function outside(s, ch, next, i, emit) {
  if (ch === '"' || ch === "'") { s.inStr = true; s.strCh = ch; emit(ch); return i; }
  if (ch === '/' && next === '/') { s.inLine = true; return i + 1; }
  if (ch === '/' && next === '*') { s.inBlock = true; return i + 1; }
  emit(ch);
  return i;
}

function consumeChar(s, text, i, emit) {
  const ch = text[i], next = text[i + 1];
  if (s.inLine)  { if (ch === '\n') { s.inLine = false; emit(ch); } return i; }
  if (s.inBlock) { if (ch === '*' && next === '/') { s.inBlock = false; return i + 1; } return i; }
  if (s.inStr)   return inString(s, ch, next, i, emit);
  return outside(s, ch, next, i, emit);
}

export function stripJsonc(text) {
  let out = '';
  const emit = (c) => { out += c; };
  const s = { inStr: false, strCh: '', inLine: false, inBlock: false };
  for (let i = 0; i < text.length; i++) {
    i = consumeChar(s, text, i, emit);
  }
  // Remove trailing commas: ,} and ,]
  return out.replace(/,(\s*[}\]])/g, '$1');
}
