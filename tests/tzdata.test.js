import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  setZoneData, zoneDataInfo, usesDeviceData, zonedParts, utcOffsetLabel, zoneWallToUtc,
  zoneAbbr, zoneDisplayName, daySegments, buildCopyText,
} from '../js/time-engine.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const data = readJson('../data/tzdata.json');
assert.equal(setZoneData(data), true);

const HOUR = 3_600_000;

test('data file: version and coverage', () => {
  const info = zoneDataInfo();
  assert.match(info.version, /^\d{4}[a-z]+$/);
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

test('a zone name is never shown beside a time it does not match', (t) => {
  // Only observable on a runtime whose own rules are out of date for a
  // zone the data file knows better — true of tz releases before 2026e.
  const dec = Date.UTC(2026, 11, 15, 20, 0);
  const device = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Winnipeg', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).format(dec);
  if (device === '15:00') {
    t.skip('this runtime already has Manitoba\'s 2026 change');
    return;
  }
  assert.equal(device, '14:00');                           // the runtime still says CST
  assert.equal(zonedParts(dec, 'America/Winnipeg').hhmm, '1500');
  assert.equal(zoneAbbr(dec, 'America/Winnipeg'), 'GMT-5'); // not "CST"
  assert.equal(zoneDisplayName(dec, 'America/Winnipeg'), 'Winnipeg');
  const text = buildCopyText(dec, [{ name: 'Takeoff', offsetMin: 0 }], ['America/Winnipeg']);
  assert.equal(text, 'Local: Winnipeg (UTC-5)\n2000Z (TUE)  1500L (TUE)  TAKEOFF');
  // where the runtime agrees, its name is used as before
  assert.equal(zoneAbbr(dec, 'America/New_York'), 'EST');
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

const formatters = new Map();
function runtimeOffset(sec, zone) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(zone, f);
  }
  const p = {};
  for (const part of f.formatToParts(sec * 1000)) p[part.type] = part.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 1000 - sec;
}

function dataOffset(sec, z) {
  let lo = 0;
  let hi = z.at.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (z.at[mid] <= sec) lo = mid + 1;
    else hi = mid;
  }
  return z.types[lo === 0 ? z.start : z.to[lo - 1]][0];
}

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
  const day = (s) => Date.parse(`${s}T00:00:00Z`) / 1000;
  const isAllowed = (zone, sec) => allowed.some((a) =>
    a.zone === zone && sec >= day(a.from) && (a.until === null || sec < day(a.until)));

  const WEEK = 7 * 86_400;
  const unexplained = [];
  const used = new Set();
  let compared = 0;
  const compare = (name, rulesZone, z, sec) => {
    if (sec < data.from || sec >= data.until) return;
    compared++;
    const ours = dataOffset(sec, z);
    const theirs = runtimeOffset(sec, name);
    if (ours === theirs) return;
    if (isAllowed(rulesZone, sec)) { used.add(rulesZone); return; }
    if (unexplained.length < 20) {
      unexplained.push(`${name} at ${new Date(sec * 1000).toISOString()}: data ${ours}, runtime ${theirs}`);
    }
  };
  for (const [name, z] of Object.entries(data.zones)) {
    try { runtimeOffset(0, name); } catch { continue; }   // zone the runtime doesn't know
    // a weekly grid, plus a minute either side of every transition
    for (let sec = data.from + 3 * 3600 + 17 * 60; sec < data.until; sec += WEEK) compare(name, name, z, sec);
    for (const at of z.at) { compare(name, name, z, at - 60); compare(name, name, z, at + 60); }
  }
  for (const [link, target] of Object.entries(data.links)) {
    try { runtimeOffset(0, link); } catch { continue; }
    for (let sec = data.from + 5 * 3600; sec < data.until; sec += 4 * WEEK) {
      compare(link, target, data.zones[target], sec);
    }
  }
  assert.deepEqual(unexplained, []);
  assert.ok(compared > 1_000_000, `only ${compared} comparisons ran`);
  // every listed exception should still be needed
  assert.deepEqual(allowed.map((a) => a.zone).filter((zone) => !used.has(zone)), []);
  t.diagnostic(`${compared} comparisons against runtime tz ${runtimeTz}; ${used.size} zones differ as listed`);
});
