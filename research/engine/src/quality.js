import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const EXTS = new Set(['.js', '.mjs', '.cjs', '.ts']);
const SKIP = new Set(['node_modules']);

// Blank out comments and string contents (keeping newlines) and record which lines hold comments.
// Heuristic: `${...}` bodies in template literals and regex literals are not parsed, so branches or
// functions inside them go uncounted.
function strip(text) {
  let code = '';
  const commentLines = new Set();
  let line = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') { commentLines.add(line); i++; }
    } else if (c === '/' && n === '*') {
      i += 2;
      code += ' '; // keep adjacent tokens apart
      commentLines.add(line);
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') { code += '\n'; line++; commentLines.add(line); }
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      code += c;
      i++;
      let closed = false;
      while (i < text.length) {
        if (text[i] === c) { closed = true; break; }
        if (text[i] === '\\') {
          i++;
          if (text[i] === '\n') { code += '\n'; line++; }
          i++;
          continue;
        }
        if (text[i] === '\n') {
          if (c !== '`') break; // unterminated: leave the newline for the main loop
          code += '\n';
          line++;
        }
        i++;
      }
      if (closed) { code += c; i++; }
    } else {
      if (c === '\n') line++;
      code += c;
      i++;
    }
  }
  return { code, commentLines };
}

const FUNCTION_RE = /\bfunction\b|=>/g;
const BRANCH_RE = /\b(?:if|for|while|case|catch)\b|&&|\|\||\?\?(?!=)|(?<!\?)\?(?![.?:=,)])/g;

const count = (re, s) => (s.match(re) || []).length;

function analyze(text) {
  const { code, commentLines } = strip(String(text));
  const rows = code.split('\n');
  if (rows[rows.length - 1] === '') rows.pop(); // trailing newline is not another line
  const lines = rows.length;
  let blank = 0;
  let maxDepth = 0;
  let depth = 0;
  rows.forEach((row, idx) => {
    if (row.trim() === '' && !commentLines.has(idx)) blank++;
    for (const ch of row) {
      if (ch === '{') maxDepth = Math.max(maxDepth, ++depth);
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
  });
  const nonBlank = lines - blank;
  return {
    nonBlank,
    commentCount: commentLines.size,
    lines,
    functions: count(FUNCTION_RE, code),
    maxDepth,
    cyclomatic: 1 + count(BRANCH_RE, code),
  };
}

const ratio = (comments, nonBlank) => (nonBlank > 0 ? comments / nonBlank : 0);

export function measureSource(text) {
  const { nonBlank, commentCount, ...m } = analyze(text);
  return { ...m, commentRatio: ratio(commentCount, nonBlank) };
}

function* walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && EXTS.has(e.name.slice(e.name.lastIndexOf('.')))) yield p;
  }
}

export function scanDir(path) {
  const perFile = [];
  const total = { files: 0, lines: 0, functions: 0, maxDepth: 0, commentRatio: 0, cyclomatic: 0 };
  let comments = 0;
  let nonBlank = 0;
  for (const file of walk(path)) {
    const { nonBlank: nb, commentCount, ...m } = analyze(readFileSync(file, 'utf8'));
    perFile.push({ file, ...m, commentRatio: ratio(commentCount, nb) });
    comments += commentCount;
    nonBlank += nb;
    total.files++;
    total.lines += m.lines;
    total.functions += m.functions;
    total.cyclomatic += m.cyclomatic;
    total.maxDepth = Math.max(total.maxDepth, m.maxDepth);
  }
  total.commentRatio = ratio(comments, nonBlank);
  return { ...total, perFile };
}
