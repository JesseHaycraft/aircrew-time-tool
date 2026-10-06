import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  setZoneData, zoneDataInfo, usesDeviceData, zonedParts, utcOffsetLabel, zoneWallToUtc,
  zoneAbbr, zoneDisplayName, daySegments, buildCopyText,
} from '../js/time-engine.js';
import { compareWithRuntime, covers } from '../tools/tzdata/reference.mjs';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const data = readJson('../data/tzdata.json');
assert.equal(setZoneData(data), true);

const HOUR = 3_600_000;

test('data file: version and coverage', () => {
  const info = zoneDataInfo();
  assert.match(info.version, /^\d{4}[a-z]+$/);
  assert.match(info.released, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(info.built, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(info.released <= info.built, 'built from a release that was already out');
  assert.equal(info.fromMs, Date.UTC(1970, 0, 1));
  // through ten full calendar years past the build year
  const builtYear = Number(info.built.slice(0, 4));
  assert.equal(info.untilMs, Date.UTC(builtYear + 11, 0, 1));
  assert.ok(Object.keys(data.zones).length > 300);
});

test('2026 rule changes: permanent time in western Canada and Morocco', () => {
  const dec = Date.UTC(2026, 11, 15, 20, 0);   // after the 1 Nov 2026 divergence
  const offsets = (ms) => Object.fromEntries([
    'America/Vancouver', 'America/Edmonton', 'America/Yellowknife', 'America/Inuvik',
    'America/Winnipeg', 'Africa/Casablanca', 'America/New_York',
  ].map((z) => [z, utcOffsetLabel(ms, z)]));
  assert.deepEqual(offsets(dec), {
    'America/Vancouver': 'UTC-7',     // British Columbia: no fall back to -8
    'America/Edmonton': 'UTC-6',      // Alberta: no fall back to -7
    'America/Yellowknife': 'UTC-6',   // Northwest Territories (an old name for Edmonton's zone)
    'America/Inuvik': 'UTC-6',
    'America/Winnipeg': 'UTC-5',      // Manitoba: no fall back to -6
    'Africa/Casablanca': 'UTC+0',     // Morocco: permanent +00 since 20 Sep 2026
    'America/New_York': 'UTC-5',      // unchanged, still falls back
  });
  assert.equal(zonedParts(dec, 'America/Vancouver').hhmm, '1300');
  assert.equal(zonedParts(dec, 'America/Winnipeg').hhmm, '1500');
  // the winter before, the old rules still applied
  assert.deepEqual(offsets(Date.UTC(2026, 0, 15, 20, 0)), {
    'America/Vancouver': 'UTC-8',
    'America/Edmonton': 'UTC-7',
    'America/Yellowknife': 'UTC-7',
    'America/Inuvik': 'UTC-7',
    'America/Winnipeg': 'UTC-6',
    'Africa/Casablanca': 'UTC+1',
    'America/New_York': 'UTC-5',
  });
});

test('2026 rule changes carry through local entry and day widths', () => {
  // noon local in Winnipeg in December is now 1700Z, not 1800Z
  assert.equal(zoneWallToUtc('America/Winnipeg', 2026, 12, 15, 12, 0), Date.UTC(2026, 11, 15, 17, 0));
  assert.equal(zoneWallToUtc('America/Vancouver', 2026, 12, 15, 12, 0), Date.UTC(2026, 11, 15, 19, 0));
  // 1 Nov 2026 is an ordinary 24 h day there, and still 25 h in New York
  const width = (zone) => {
    const seg = daySegments(zone, Date.UTC(2026, 9, 31), Date.UTC(2026, 10, 3)).find((s) => s.day === '01');
    return (seg.end - seg.start) / HOUR;
  };
  assert.equal(width('America/Winnipeg'), 24);
  assert.equal(width('America/Vancouver'), 24);
  assert.equal(width('America/New_York'), 25);
});

test('old zone names follow their current zone', () => {
  const t = Date.UTC(2026, 6, 15, 12, 0);
  for (const [oldName, zone] of [
    ['US/Eastern', 'America/New_York'], ['Asia/Calcutta', 'Asia/Kolkata'], ['UTC', 'Etc/UTC'],
  ]) {
    assert.equal(usesDeviceData(t, oldName), false, oldName);
    assert.deepEqual(zonedParts(t, oldName), zonedParts(t, zone));
    assert.equal(utcOffsetLabel(t, oldName), utcOffsetLabel(t, zone));
  }
  assert.equal(zonedParts(t, 'Asia/Calcutta').hhmm, '1730');
});

test('outside the data file the device\'s rules are used, and flagged', () => {
  const inside = Date.UTC(2026, 6, 15);
  assert.equal(usesDeviceData(inside, 'America/New_York'), false);
  assert.equal(usesDeviceData(Date.UTC(1969, 6, 20), 'America/New_York'), true);
  assert.equal(usesDeviceData(zoneDataInfo().untilMs, 'America/New_York'), true);
  assert.equal(usesDeviceData(zoneDataInfo().untilMs - 1, 'America/New_York'), false);
  assert.equal(usesDeviceData(inside, 'Mars/Olympus_Mons'), true);
  // the fallback still converts: the Moon landing, 2017Z on 20 Jul 1969, was 1617 EDT
  const moon = Date.UTC(1969, 6, 20, 20, 17);
  assert.equal(zonedParts(moon, 'America/New_York').hhmm, '1617');
  assert.equal(utcOffsetLabel(moon, 'America/New_York'), 'UTC-4');
  // and past the far end of the file
  const later = Date.UTC(2040, 6, 15, 16, 0);
  assert.equal(usesDeviceData(later, 'America/New_York'), true);
  assert.equal(zonedParts(later, 'America/New_York').hhmm, '1200');
  assert.equal(zoneAbbr(later, 'America/New_York'), 'EDT');
});

test('short zone names are the tz database\'s own, whatever the device calls them', () => {
  const jan = Date.UTC(2027, 0, 15, 20, 0);
  const jul = Date.UTC(2027, 6, 15, 20, 0);
  const names = (zone) => [zoneAbbr(jan, zone), zoneAbbr(jul, zone)];
  assert.deepEqual(names('America/New_York'), ['EST', 'EDT']);
  assert.deepEqual(names('Europe/London'), ['GMT', 'BST']);
  assert.deepEqual(names('Europe/Paris'), ['CET', 'CEST']);
  assert.deepEqual(names('Asia/Tokyo'), ['JST', 'JST']);
  assert.deepEqual(names('Pacific/Guam'), ['ChST', 'ChST']);
  assert.deepEqual(names('Australia/Sydney'), ['AEDT', 'AEST']);
  assert.deepEqual(names('UTC'), ['UTC', 'UTC']);
  // the zones that went to permanent time in 2026 carry the database's labels
  assert.deepEqual(names('America/Vancouver'), ['MST', 'MST']);
  assert.deepEqual(names('America/Edmonton'), ['CST', 'CST']);
  assert.deepEqual(names('America/Winnipeg'), ['EST', 'EST']);
  // no abbreviation in the database, only a numeric placeholder: the city stands in
  assert.deepEqual(names('Asia/Dubai'), ['', '']);
  assert.deepEqual(names('Asia/Kabul'), ['', '']);
  assert.equal(zoneDisplayName(jan, 'Asia/Dubai'), 'Dubai');
  assert.equal(zoneDisplayName(jan, 'Europe/London'), 'GMT');

  const dec = Date.UTC(2026, 11, 15, 20, 0);
  const text = buildCopyText(dec, [{ name: 'Takeoff', ms: dec }], ['America/Winnipeg']);
  assert.equal(text, 'Local: Winnipeg (EST)\n1500L (TUE)  2000Z (TUE)  Takeoff');
});

test('a damaged data file is refused and the good one stays in place', () => {
  const copy = () => structuredClone(data);
  const broken = [
    null,
    {},
    { ...copy(), format: 2 },
    { ...copy(), version: 'latest' },
    { ...copy(), from: data.until },
  ];
  const outOfOrder = copy();
  outOfOrder.zones['America/Chicago'].at.reverse();
  const badIndex = copy();
  badIndex.zones['America/Chicago'].to[0] = 99;
  const badLink = copy();
  badLink.links['US/Eastern'] = 'America/Nowhere';
  const wrongAnswer = copy();   // well-formed, but New York is an hour off
  for (const type of wrongAnswer.zones['America/New_York'].types) type[0] += 3600;
  for (const bad of [...broken, outOfOrder, badIndex, badLink, wrongAnswer]) {
    assert.equal(setZoneData(bad), false);
  }
  assert.equal(zoneDataInfo().version, data.version);
  assert.equal(utcOffsetLabel(Date.UTC(2026, 6, 15), 'America/New_York'), 'UTC-4');
});

// ---- comparison against an independent implementation ----
// The JavaScript runtime compiles the same IANA rules with different code
// (ICU), so agreement across every zone is strong evidence the data file
// was built correctly. A runtime on an older tz release legitimately
// differs where the rules have changed since; those differences are
// listed, with their release notes, in reference-differences.json.

test('every zone matches the runtime\'s own rules, except where release notes say otherwise', (t) => {
  const runtimeTz = process.versions.tz;
  const known = readJson('./reference-differences.json');
  let allowed;
  if (runtimeTz === data.version) allowed = [];
  else if (Array.isArray(known[runtimeTz])) allowed = known[runtimeTz];
  else {
    t.skip(`no expected-differences list for a runtime on tz ${runtimeTz} (data is ${data.version})`);
    return;
  }
  const { compared, differences } = compareWithRuntime(data);
  const used = new Set();
  const unexplained = [];
  for (const d of differences) {
    const entry = allowed.find((a) => covers(a, d.zone, d.sec));
    if (entry) used.add(entry.zone);
    else unexplained.push(`${d.name} at ${new Date(d.sec * 1000).toISOString()}: data ${d.ours}, runtime ${d.theirs}`);
  }
  assert.deepEqual(unexplained.slice(0, 20), []);
  assert.ok(compared > 1_000_000, `only ${compared} comparisons ran`);
  // every listed exception should still be needed
  assert.deepEqual(allowed.map((a) => a.zone).filter((zone) => !used.has(zone)), []);
  t.diagnostic(`${compared} comparisons against runtime tz ${runtimeTz}; ${used.size} zones differ as listed`);
});
