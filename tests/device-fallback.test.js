// No zone data is loaded in this file: this is the app when
// data/tzdata.json could not be fetched, running on the device's rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zoneDataInfo, usesDeviceData, zonedParts, utcOffsetLabel, zoneWallToUtc,
  zoneAbbr, zoneDisplayName, daySegments, buildCopyText, makeUtcInstant,
} from '../js/time-engine.js';

test('without the data file everything still converts, on the device\'s rules', () => {
  assert.equal(zoneDataInfo(), null);
  const t = Date.UTC(2026, 8, 11, 5, 30);   // FRI 11 SEP 2026 0530Z
  assert.equal(usesDeviceData(t, 'America/New_York'), true);
  assert.equal(usesDeviceData(t, 'UTC'), true);
  assert.deepEqual(zonedParts(t, 'America/New_York'), {
    hhmm: '0130', weekday: 'FRI', day: '11', month: 'SEP', year: '2026', dateKey: '2026-SEP-11',
  });
  assert.equal(utcOffsetLabel(t, 'America/New_York'), 'UTC-4');
  assert.equal(utcOffsetLabel(t, 'Asia/Kolkata'), 'UTC+5:30');
  assert.equal(utcOffsetLabel(t, 'UTC'), 'UTC+0');
  assert.equal(zoneAbbr(t, 'America/New_York'), 'EDT');
  assert.equal(zoneDisplayName(t, 'Pacific/Guam'), 'Guam');
  assert.equal(zoneWallToUtc('America/New_York', 2026, 9, 11, 1, 30), t);
  const nov = daySegments('America/New_York', Date.UTC(2026, 9, 30), Date.UTC(2026, 10, 3));
  const dst = nov.find((s) => s.day === '01');
  assert.equal(dst.end - dst.start, 25 * 3_600_000);
});

test('copy text is the same on the device\'s rules', () => {
  const takeoff = makeUtcInstant(2026, 254, 5, 30);
  const text = buildCopyText(takeoff, [
    { name: 'Takeoff', offsetMin: 0 },
    { name: 'Brief', offsetMin: -180 },
  ], ['America/New_York']);
  assert.equal(text, [
    'Local: New York (EDT)',
    '0230Z (FRI)  2230L (THU)  Brief',
    '0530Z (FRI)  0130L (FRI)  TAKEOFF',
  ].join('\n'));
});
