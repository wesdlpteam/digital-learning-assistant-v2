import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertNoDroppedFieldUsage,
  assertNoGoogleScriptRefs,
  assertSizeUnder
} from '../tools/lib/verify.mjs';

test('passes when the page references no dropped field', () => {
  assert.doesNotThrow(() => assertNoDroppedFieldUsage('var x = u.ca + u.yl + u.s;'));
});

test('throws naming the dropped field the page still reads', () => {
  assert.throws(
    () => assertNoDroppedFieldUsage('var t = unit.plannerText;'),
    /plannerText/
  );
});

test('does not false-positive on a field name inside a longer word', () => {
  assert.doesNotThrow(() => assertNoDroppedFieldUsage('var x = u.auditedByHand;'));
});

test('passes when no Google Apps Script reference survives', () => {
  assert.doesNotThrow(() => assertNoGoogleScriptRefs('<script>var a=1;</script>'));
});

test('throws when a Google Apps Script reference survives', () => {
  assert.throws(
    () => assertNoGoogleScriptRefs('fetch("https://script.google.com/macros/s/x/exec")'),
    /script\.google\.com/
  );
});

test('also rejects the sign-in and Sheets hosts the Studio would use', () => {
  assert.throws(
    () => assertNoGoogleScriptRefs('<script src="https://accounts.google.com/gsi/client"></script>'),
    /accounts\.google\.com/
  );
  assert.throws(
    () => assertNoGoogleScriptRefs('fetch("https://sheets.googleapis.com/v4/spreadsheets/x")'),
    /sheets\.googleapis\.com/
  );
});

test('names the file it checked, so a build failure points at the right output', () => {
  assert.throws(
    () => assertNoGoogleScriptRefs('accounts.google.com', 'js/02-ui-load-navigation.js'),
    /js\/02-ui-load-navigation\.js/
  );
});

test('reports every offending host at once rather than one per run', () => {
  assert.throws(
    () => assertNoGoogleScriptRefs('script.google.com and accounts.google.com'),
    /script\.google\.com x1, accounts\.google\.com x1/
  );
});

test('size guard passes under the cap and throws over it', () => {
  assert.doesNotThrow(() => assertSizeUnder(1000, 2000, 'data.json'));
  assert.throws(() => assertSizeUnder(3000, 2000, 'data.json'), /data\.json/);
});
