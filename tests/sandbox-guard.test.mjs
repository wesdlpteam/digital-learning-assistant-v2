import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserScript } from './helpers/load-browser-script.mjs';

function install() {
  const calls = [];
  const fakeWindow = {
    console,
    location: {
      origin: 'https://wesdlpteam.github.io',
      href: 'https://wesdlpteam.github.io/dla-sandbox/'
    },
    fetch: url => { calls.push(String(url)); return Promise.resolve({ ok: true, real: true }); }
  };
  fakeWindow.window = fakeWindow;
  const navigator = { sendBeacon: () => { calls.push('beacon'); return true; } };
  // The guard writes onto window, not the bare vm global, so ask for no names
  // and assert against fakeWindow instead.
  loadBrowserScript(
    'tools/browser/sandbox-guard.js',
    [],
    { window: fakeWindow, navigator, document: { location: fakeWindow.location } }
  );
  return { fakeWindow, navigator, calls };
}

test('marks itself installed on window', () => {
  const { fakeWindow } = install();
  assert.equal(fakeWindow.__sandboxGuardInstalled, true);
});

test('blocks fetch to an absolute cross-origin URL', async () => {
  const { fakeWindow, calls } = install();
  const res = await fakeWindow.fetch('https://script.google.com/macros/s/abc/exec');
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
});

test('blocks the sandbox:// sentinel left behind by the transforms', async () => {
  const { fakeWindow, calls } = install();
  const res = await fakeWindow.fetch('sandbox://blocked');
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
});

test('blocks a protocol-relative URL', async () => {
  const { fakeWindow, calls } = install();
  const res = await fakeWindow.fetch('//script.google.com/macros/s/abc/exec');
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
});

test('allows a relative URL through to the real fetch', async () => {
  const { fakeWindow, calls } = install();
  const res = await fakeWindow.fetch('data.json');
  assert.equal(res.real, true);
  assert.deepEqual(calls, ['data.json']);
});

test('allows a same-origin absolute URL through', async () => {
  const { fakeWindow, calls } = install();
  await fakeWindow.fetch('https://wesdlpteam.github.io/dla-sandbox/libraries.json');
  assert.equal(calls.length, 1);
});

test('reads the url off a Request-like object', async () => {
  const { fakeWindow, calls } = install();
  const res = await fakeWindow.fetch({ url: 'https://script.google.com/x' });
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
});

test('a blocked fetch resolves rather than rejecting, so page catch blocks are not needed', async () => {
  const { fakeWindow } = install();
  const res = await fakeWindow.fetch('https://script.google.com/x');
  assert.equal(res.status, 0);
  assert.equal(typeof res.text, 'function');
  assert.equal(await res.text(), '');
});

test('sendBeacon is neutered and reports success so page code does not retry', () => {
  const { navigator, calls } = install();
  assert.equal(navigator.sendBeacon('https://script.google.com/x', 'body'), true);
  assert.equal(calls.length, 0);
});
