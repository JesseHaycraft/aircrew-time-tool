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
    assert.equal(t.landingCountdown, false);
    const evIds = t.events.map((e) => e.id);
    assert.equal(new Set(evIds).size, evIds.length, `${t.name}: event ids repeat`);
    for (const e of t.events) {
      assert.notEqual(e.id, 'takeoff');
      assert.notEqual(e.id, 'landing');
      assert.equal(typeof e.countdown, 'boolean');
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
    'Enter crew rest': -14.5, 'Stop drink': -12, 'Show': -2.5, 'Brief': -2, 'Step': -1.5,
    'Doors closed': -0.5, 'Engine start': -25 / 60, 'Duty day ends': 13.5,
  });
  assert.deepEqual(at(formation), {
    'Enter crew rest': -14.5, 'Stop drink': -12, 'Show': -2.5, 'Formation brief': -2.25, 'Step': -1.5,
    'Doors closed': -0.5, 'Engine start': -25 / 60, 'Duty day ends': 13.5,
  });
  assert.deepEqual(at(deice), {
    'Enter crew rest': -14.5, 'Stop drink': -12, 'MX de-ice start': -5, 'MX de-ice complete': -3,
    'Show': -2.5, 'Brief': -2, 'Step': -1.75, 'Doors closed': -55 / 60, 'Anti-ice start': -55 / 60,
    'Anti-ice complete': -25 / 60, 'Engine start': -25 / 60, 'Duty day ends': 13.5,
  });
  // crew rest and the duty day are counted from show, not takeoff
  const show = single.events.find((e) => e.name === 'Show');
  const rest = single.events.find((e) => e.name === 'Enter crew rest');
  const dde = single.events.find((e) => e.name === 'Duty day ends');
  assert.equal(rest.source, show.id);
  assert.equal(rest.offsetMin, -12 * 60);
  assert.equal(dde.source, show.id);
  assert.equal(dde.offsetMin, 16 * 60);
});

test('built-in templates: countdowns on crew rest and takeoff only', () => {
  for (const t of builtInTemplates()) {
    assert.equal(t.takeoffCountdown, true, t.name);
    assert.deepEqual(
      t.events.filter((e) => e.countdown).map((e) => e.name),
      ['Enter crew rest'],
      t.name,
    );
  }
});

test('built-in templates: only crew rest, show and takeoff are copied by default', () => {
  for (const t of builtInTemplates()) {
    assert.equal(t.takeoffCopy, true, t.name);
    assert.equal(t.landingCopy, false, t.name);
    assert.deepEqual(
      t.events.filter((e) => e.copy).map((e) => e.name),
      ['Enter crew rest', 'Show'],
      t.name,
    );
    for (const e of t.events) assert.equal(typeof e.copy, 'boolean');
  }
});
