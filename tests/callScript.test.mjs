import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScript, promptCount, scriptFor, STARTER_SCRIPTS } from '../lib/callScript.js';

test('one prompt per line; # makes a heading; blanks and bullets are tidied', () => {
  const items = parseScript('# Greeting\n\n  Thank the caller  \n- Get a phone number\n#Rooms\n* Which rooms?\r\n');
  assert.deepEqual(items.map((i) => [i.type, i.text]), [
    ['heading', 'Greeting'], ['prompt', 'Thank the caller'], ['prompt', 'Get a phone number'], ['heading', 'Rooms'], ['prompt', 'Which rooms?'],
  ]);
  assert.equal(promptCount(items), 3);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, 'ids are unique');
});

test('an empty script shows nothing', () => {
  assert.deepEqual(parseScript(''), []);
  assert.deepEqual(parseScript(null), []);
  assert.deepEqual(parseScript('   \n  \n'), []);
  assert.deepEqual(scriptFor({}, 'carpet'), []);
  assert.deepEqual(scriptFor(undefined, 'restoration'), []);
});

test('the right script is chosen for the kind of call', () => {
  const settings = { call_script_carpet: 'Ask rooms', call_script_restoration: 'Ask source' };
  assert.equal(scriptFor(settings, 'carpet')[0].text, 'Ask rooms');
  assert.equal(scriptFor(settings, 'restoration')[0].text, 'Ask source');
  assert.deepEqual(scriptFor(settings, ''), []);
});

test('a lone # is not an empty heading', () => {
  assert.deepEqual(parseScript('#').map((i) => i.type), ['prompt']);
});

test('the starter scripts parse and are within the size limit', () => {
  for (const k of ['carpet', 'restoration']) {
    assert.ok(STARTER_SCRIPTS[k].length < 4000);
    assert.ok(promptCount(parseScript(STARTER_SCRIPTS[k])) >= 8);
    assert.equal(parseScript(STARTER_SCRIPTS[k])[0].type, 'heading');
  }
});
