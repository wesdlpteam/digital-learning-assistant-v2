import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// These files ship with CRLF endings. Normalise on read so `$` and `.` in the
// slicing regexes behave the way the rest of this helper assumes.
function readSource(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8').split('\r\n').join('\n');
}

// Pulls named top-level `function foo(...) { ... }` declarations out of a file
// that node cannot import directly — an inline <script> inside index.html, or
// an Apps Script Code.js that only runs inside Google's runtime. Brace-matched
// so nested blocks and object literals survive intact.
function sliceFunction(source, name) {
  const re = new RegExp('(^|\\n)function\\s+' + name.replace(/[$]/g, '\\$') + '\\s*\\(', 'g');
  const m = re.exec(source);
  if (!m) throw new Error(`no top-level function "${name}" in source`);
  const start = m.index + (m[1] ? m[1].length : 0);
  const bodyStart = source.indexOf('{', re.lastIndex);
  if (bodyStart === -1) throw new Error(`function "${name}" has no body`);
  let depth = 0;
  let inStr = null;
  let inLine = false;
  let inBlock = false;
  let inRe = false;
  for (let i = bodyStart; i < source.length; i++) {
    const c = source[i];
    const prev = source[i - 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && source[i + 1] === '/') { inBlock = false; i++; } continue; }
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (inRe) { if (c === '\\') { i++; continue; } if (c === '/') inRe = false; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '/' && source[i + 1] === '/') { inLine = true; i++; continue; }
    if (c === '/' && source[i + 1] === '*') { inBlock = true; i++; continue; }
    // A '/' that follows an operator or '(' opens a regex literal, not division.
    if (c === '/' && /[(=,:[!&|?{};+\-*%~^]/.test(String(prev || '').trim() || '=')) { inRe = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces while slicing "${name}"`);
}

// Evaluates the named functions in an isolated context seeded with `globals`
// (stubs for browser or Apps Script APIs the functions touch at call time).
export function loadFunctions(relPath, names, globals = {}) {
  const source = readSource(relPath);
  const src = names.map(n => sliceFunction(source, n)).join('\n');
  const context = vm.createContext({ console, Date, JSON, Math, Number, String, Object, Array, Set, RegExp, ...globals });
  vm.runInContext(src, context, { filename: relPath });
  const out = {};
  for (const n of names) out[n] = context[n];
  return out;
}

// Pulls a top-level `const NAME = ...;` / `var NAME = ...;` value out of a file.
// Object and array literals are brace-matched; anything else runs to the end of
// its line, minus a trailing `;` and any trailing `// comment`.
export function loadConstants(relPath, names) {
  const source = readSource(relPath);
  const out = {};
  for (const n of names) {
    const re = new RegExp('(?:^|\\n)\\s*(?:const|var|let)\\s+' + n + '\\s*=\\s*');
    const m = source.match(re);
    if (!m) throw new Error(`no top-level constant "${n}" in ${relPath}`);
    const valueStart = m.index + m[0].length;
    const open = source[valueStart];
    let raw;
    if (open === '{' || open === '[') {
      const close = open === '{' ? '}' : ']';
      let depth = 0;
      let end = -1;
      for (let i = valueStart; i < source.length; i++) {
        if (source[i] === open) depth++;
        else if (source[i] === close) { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      if (end === -1) throw new Error(`unbalanced literal for "${n}" in ${relPath}`);
      raw = source.slice(valueStart, end);
    } else {
      const eol = source.indexOf('\n', valueStart);
      raw = source.slice(valueStart, eol === -1 ? source.length : eol);
      raw = raw.replace(/\/\/.*$/, '').trim().replace(/;$/, '');
    }
    out[n] = vm.runInNewContext('(' + raw + ')');
  }
  return out;
}
