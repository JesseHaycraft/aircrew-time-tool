import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtInTemplates } from '../js/builtin-templates.js';
import { resolveEventTimes } from '../js/time-engine.js';

const HOUR = 3_600_000;
const takeoff = Date.UTC(2026, 9, 7, 6, 0);   // 0600Z

test('built-in templates: three McGuire local sequences, in order', () => {
  assert.deepEqual(builtInTemplates().map((t) => t.name), [
    'McGuire local single-ship',
    'McGuire local formation',
    'McGuire local de-ice',
  ]);
});

test('built-in templates: fixed ids, flagged built-in, fresh objects each call', () => {
  const a = builtInTemplates();
  const b = builtInTemplates();
  assert.deepEqual(a, b);
  assert.notEqual(a[0], b[0]);
  assert.notEqual(a[0].events, b[0].events);
  const ids = a.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of a) {
    assert.equal(t.builtIn, true);
    assert.equal(t.includeLanding, true);
    assert.equal(t.takeoffCountdown, false);
    assert.equal(t.landingCountdown, false);
    const evIds = t.events.map((e) => e.id);
    assert.equal(new Set(evIds).size, evIds.length, `${t.name}: event ids repeat`);
    for (const e of t.events) {
      assert.notEqual(e.id, 'takeoff');
      assert.notEqual(e.id, 'landing');
      assert.equal(e.countdown, false);
      assert.ok(Number.isInteger(e.offsetMin));
    }
  }
});

test('built-in templates: every event resolves from a takeoff alone', () => {
  for (const t of builtInTemplates()) {
    const times = resolveEventTimes(t.events, takeoff);
    for (const e of t.events) {
      assert.ok(typeof times.get(e.id) === 'number', `${t.name}: ${e.name} has no time`);
    }
  }
});

test('built-in templates: the event times', () => {
  const at = (t) => {
    const times = resolveEventTimes(t.events, takeoff);
    return Object.fromEntries(t.events.map((e) => [e.name, (times.get(e.id) - takeoff) / HOUR]));
  };
  const [single, formation, deice] = builtInTemplates();
  assert.deepEqual(at(single), {
    'Stop drink': -12, 'Show': -2.5, 'Brief': -2, 'Step': -1.5,
    'Doors closed': -0.5, 'Engine start': -25 / 60, 'Duty day ends': 13.5,
  });
  assert.deepEqual(at(formation), {
    'Stop drink': -12, 'Show': -2.5, 'Formation brief': -2.25, 'Step': -1.5,
    'Doors closed': -0.5, 'Engine start': -25 / 60, 'Duty day ends': 13.5,
  });
  assert.deepEqual(at(deice), {
    'Stop drink': -12, 'Show': -2.5, 'Brief': -2, 'Step': -1.75,
    'Doors closed': -55 / 60, 'Engine start': -25 / 60, 'Duty day ends': 13.5,
  });
  // the duty day is counted from show, not takeoff
  const dde = single.events.find((e) => e.name === 'Duty day ends');
  assert.equal(dde.source, single.events.find((e) => e.name === 'Show').id);
  assert.equal(dde.offsetMin, 16 * 60);
});
