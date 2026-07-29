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

test('size guard passes under the cap and throws over it', () => {
  assert.doesNotThrow(() => assertSizeUnder(1000, 2000, 'data.json'));
  assert.throws(() => assertSizeUnder(3000, 2000, 'data.json'), /data\.json/);
});
