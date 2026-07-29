import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Evaluates a plain browser script (no modules) in an isolated context and
// hands back the globals it declared. Lets us unit-test code that has to ship
// as an inline <script> in the generated page.
export function loadBrowserScript(relPath, names, extraGlobals = {}) {
  const source = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const context = vm.createContext({ console, ...extraGlobals });
  vm.runInContext(source, context, { filename: relPath });
  const out = {};
  for (const name of names) {
    if (typeof context[name] === 'undefined') {
      throw new Error(`${relPath} did not define global "${name}"`);
    }
    out[name] = context[name];
  }
  return out;
}
