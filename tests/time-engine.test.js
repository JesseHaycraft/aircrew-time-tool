import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLeapYear, daysInYear, dayOfYearUtc, parseTimeHHMM, parseJulianDay,
  parseOffset, parseOffsetEntry, minutesToHMM, resolveJulianYear, makeUtcInstant,
  zonedParts, isValidZone, buildCopyText,
  zoneLabel, utcOffsetLabel, longZoneName, zoneDisplayName, zoneWallToUtc,
  daySegments, formatCountdown, sunEvents, nightIntervals, parseDuration,
  formatDurationEntry, resolveEventTimes, eventDependsOn,
  setZoneData,
} from '../js/time-engine.js';
import { readFileSync } from 'node:fs';

// Everything below runs on the app's own zone rules, as the app does.
assert.equal(setZoneData(JSON.parse(readFileSync(new URL('../data/tzdata.json', import.meta.url), 'utf8'))), true);

test('leap years', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2026), false);
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(1900), false);
  assert.equal(daysInYear(2024), 366);
  assert.equal(daysInYear(2026), 365);
});

test('day-of-year round trips', () => {
  assert.equal(dayOfYearUtc(Date.UTC(2026, 0, 1, 12)), 1);
  assert.equal(dayOfYearUtc(Date.UTC(2026, 8, 11)), 254);
  assert.equal(dayOfYearUtc(Date.UTC(2024, 11, 31)), 366);
  assert.equal(dayOfYearUtc(Date.UTC(2024, 1, 29)), 60);
  assert.equal(makeUtcInstant(2026, 254, 5, 30), Date.UTC(2026, 8, 11, 5, 30));
  assert.equal(makeUtcInstant(2024, 60, 0, 0), Date.UTC(2024, 1, 29));
});

test('time parsing', () => {
  assert.deepEqual(parseTimeHHMM('0530'), { h: 5, m: 30 });
  assert.deepEqual(parseTimeHHMM('530'), { h: 5, m: 30 });
  assert.deepEqual(parseTimeHHMM('05:30'), { h: 5, m: 30 });
  assert.deepEqual(parseTimeHHMM('2359'), { h: 23, m: 59 });
  assert.equal(parseTimeHHMM('2400'), null);
  assert.equal(parseTimeHHMM('0560'), null);
  assert.equal(parseTimeHHMM('12'), null);
  assert.equal(parseTimeHHMM('abc'), null);
});

test('julian day parsing', () => {
  assert.equal(parseJulianDay('254'), 254);
  assert.equal(parseJulianDay('001'), 1);
  assert.equal(parseJulianDay('366'), 366);
  assert.equal(parseJulianDay('0'), null);
  assert.equal(parseJulianDay('367'), null);
  assert.equal(parseJulianDay('12a'), null);
});

test('offset parsing and formatting', () => {
  assert.equal(parseOffset('-3:00'), -180);
  assert.equal(parseOffset('-0:30'), -30);
  assert.equal(parseOffset('+1:15'), 75);
  assert.equal(parseOffset('2:30'), 150);
  assert.equal(parseOffset('45'), 45);
  assert.equal(parseOffset('-45'), -45);
  assert.equal(parseOffset('0:00'), 0);
  assert.equal(parseOffset('1:5'), null);
  assert.equal(parseOffset(''), null);
  assert.equal(minutesToHMM(150), '2:30');
  assert.equal(minutesToHMM(-150), '2:30');
  assert.equal(minutesToHMM(45), '0:45');
  assert.equal(minutesToHMM(0), '0:00');
  assert.equal(minutesToHMM(960), '16:00');
});

test('year resolution: nearest upcoming with grace window', () => {
  const now = Date.UTC(2026, 8, 9, 14, 0); // 9 Sep 2026 = day 252
  assert.equal(resolveJulianYear(254, now), 2026); // two days out
  assert.equal(resolveJulianYear(252, now), 2026); // today
  assert.equal(resolveJulianYear(250, now), 2026); // 2 days past, inside grace
  assert.equal(resolveJulianYear(249, now), 2027); // 3 days past → next year
  assert.equal(resolveJulianYear(4, Date.UTC(2026, 11, 28)), 2027); // late Dec → January
  assert.equal(resolveJulianYear(366, now), 2028); // next leap year
});

test('offsets across midnight land on the previous Julian day', () => {
  const takeoff = makeUtcInstant(2026, 254, 1, 30);
  const brief = takeoff + parseOffset('-3:00') * 60_000;
  assert.equal(dayOfYearUtc(brief), 253);
  assert.equal(zonedParts(brief, 'UTC').hhmm, '2230');
});

test('zone conversion respects DST as of the event date', () => {
  // US DST ends 1 Nov 2026: same Zulu clock time, different New York local
  assert.equal(zonedParts(Date.UTC(2026, 9, 5, 15, 0), 'America/New_York').hhmm, '1100'); // EDT
  assert.equal(zonedParts(Date.UTC(2026, 10, 5, 15, 0), 'America/New_York').hhmm, '1000'); // EST
});

test('half-hour zones and the date line', () => {
  assert.equal(zonedParts(Date.UTC(2026, 0, 1, 0, 0), 'Asia/Kolkata').hhmm, '0530');
  const nz = zonedParts(Date.UTC(2026, 0, 1, 12, 0), 'Pacific/Auckland');
  assert.equal(nz.hhmm, '0100');
  assert.equal(nz.day, '02'); // already the next calendar day
});

test('local wall time to UTC', () => {
  assert.equal(zoneWallToUtc('America/New_York', 2026, 9, 11, 1, 30), Date.UTC(2026, 8, 11, 5, 30)); // EDT
  assert.equal(zoneWallToUtc('America/New_York', 2026, 11, 5, 10, 0), Date.UTC(2026, 10, 5, 15, 0)); // EST
  assert.equal(zoneWallToUtc('Asia/Kolkata', 2026, 1, 15, 11, 0), Date.UTC(2026, 0, 15, 5, 30));
  assert.equal(zoneWallToUtc('UTC', 2026, 9, 11, 5, 30), Date.UTC(2026, 8, 11, 5, 30));
  // fall-back: 0130 on 1 Nov 2026 in New York happens twice; the earlier
  // (EDT) instant is returned
  assert.equal(zoneWallToUtc('America/New_York', 2026, 11, 1, 1, 30), Date.UTC(2026, 10, 1, 5, 30));
  // spring-forward: 0230 on 8 Mar 2026 doesn't exist; resolves just past
  // the gap (0330 EDT)
  assert.equal(zoneWallToUtc('America/New_York', 2026, 3, 8, 2, 30), Date.UTC(2026, 2, 8, 7, 30));
});

test('day segments: continuity, DST widths, offset midnights', () => {
  const HOUR = 3_600_000;
  const nov = daySegments('America/New_York', Date.UTC(2026, 9, 30), Date.UTC(2026, 10, 3));
  for (let i = 1; i < nov.length; i++) assert.equal(nov[i].start, nov[i - 1].end);
  const dst = nov.find((s) => s.day === '01');
  assert.equal(dst.end - dst.start, 25 * HOUR); // fall-back day is 25h wide
  assert.equal(dst.weekday, 'SUN');
  const mar = daySegments('America/New_York', Date.UTC(2026, 2, 7), Date.UTC(2026, 2, 9));
  const gap = mar.find((s) => s.day === '08');
  assert.equal(gap.end - gap.start, 23 * HOUR); // spring-forward day is 23h

  // Kolkata's midnight is 1830Z the previous day
  const ind = daySegments('Asia/Kolkata', Date.UTC(2026, 8, 10), Date.UTC(2026, 8, 11));
  const d11 = ind.find((s) => s.day === '11');
  assert.equal(d11.start, Date.UTC(2026, 8, 10, 18, 30));

  const z = daySegments('UTC', Date.UTC(2026, 8, 10, 1), Date.UTC(2026, 8, 10, 2));
  assert.equal(z[0].start, Date.UTC(2026, 8, 10));
  assert.equal(z[0].end - z[0].start, 24 * HOUR);
  assert.equal(z[0].weekday, 'THU');
});

test('zone validation', () => {
  assert.equal(isValidZone('America/New_York'), true);
  assert.equal(isValidZone('UTC'), true);
  assert.equal(isValidZone('Mars/Olympus_Mons'), false);
  assert.equal(isValidZone(''), false);
});


test('zone names and UTC offsets', () => {
  const june = Date.UTC(2026, 5, 15);
  assert.equal(zoneLabel('America/New_York'), 'New York');
  assert.equal(zoneLabel('Pacific/Guam'), 'Guam');
  assert.equal(zoneDisplayName(june, 'America/New_York'), 'EDT');
  assert.equal(zoneDisplayName(june, 'Pacific/Guam'), 'ChST');
  assert.equal(zoneDisplayName(june, 'Asia/Dubai'), 'Dubai'); // the tz database has no abbreviation, only "+04"
  assert.equal(utcOffsetLabel(june, 'America/New_York'), 'UTC-4');
  assert.equal(utcOffsetLabel(Date.UTC(2026, 0, 15), 'America/New_York'), 'UTC-5');
  assert.equal(utcOffsetLabel(june, 'Asia/Kolkata'), 'UTC+5:30');
  assert.equal(utcOffsetLabel(june, 'UTC'), 'UTC+0');
  assert.equal(longZoneName(june, 'Pacific/Guam'), 'Chamorro Standard Time');
});




test('copy text: Zulu rollover shows the weekday', () => {
  const takeoff = makeUtcInstant(2026, 254, 1, 30);
  const text = buildCopyText(takeoff, [
    { name: 'Brief', ms: takeoff - 240 * 60_000 },
    { name: 'Takeoff', ms: takeoff },
  ], []);
  assert.equal(text, '2130Z (THU)  Brief\n0130Z (FRI)  TAKEOFF'); // no zone → no header
});

test('countdown formatting', () => {
  const t = Date.UTC(2026, 8, 11, 10, 0);
  const min = 60_000;
  assert.equal(formatCountdown(t, t), 'now');
  assert.equal(formatCountdown(t, t - 20_000), 'now');
  assert.equal(formatCountdown(t, t - min), 'in 1min');
  assert.equal(formatCountdown(t, t - 2 * min), 'in 2mins');
  // a tick that fires just after the minute boundary still reads whole minutes
  assert.equal(formatCountdown(t, t - 2 * min + 400), 'in 2mins');
  assert.equal(formatCountdown(t, t - 60 * min), 'in 1hr');
  assert.equal(formatCountdown(t, t - (17 * 60 + 18) * min), 'in 17hrs 18mins');
  assert.equal(formatCountdown(t, t - (29 * 60 + 20) * min), 'in 1day 5hrs 20mins');
  assert.equal(formatCountdown(t, t + 7 * min), '7mins ago');
  assert.equal(formatCountdown(t, t + (50 * 60) * min), '2days 2hrs ago');
});

const near = (actual, expected, tolMin, label) => {
  const diff = Math.abs(actual - expected) / 60_000;
  assert.ok(diff <= tolMin, `${label}: off by ${diff.toFixed(1)} min`);
};

test('sunrise and sunset', () => {
  // New York, 10 Sep 2026: sunrise ≈ 06:33 EDT (10:33Z), sunset ≈ 19:15 EDT (23:15Z)
  const ny = sunEvents(Date.UTC(2026, 8, 10), 40.71, -74.01);
  near(ny.sunrise, Date.UTC(2026, 8, 10, 10, 33), 8, 'NY sunrise');
  near(ny.sunset, Date.UTC(2026, 8, 10, 23, 15), 8, 'NY sunset');
  // Honolulu, 10 Sep 2026 UTC day: sunrise ≈ 06:14 HST (16:14Z), sunset ≈ 18:37 HST (04:37Z next day)
  const hnl = sunEvents(Date.UTC(2026, 8, 10), 21.31, -157.86);
  near(hnl.sunrise, Date.UTC(2026, 8, 10, 16, 14), 8, 'HNL sunrise');
  near(hnl.sunset, Date.UTC(2026, 8, 11, 4, 37), 8, 'HNL sunset');
  // Tromsø: midnight sun in June, polar night in December
  assert.equal(sunEvents(Date.UTC(2026, 5, 21), 69.65, 18.96).polar, 'day');
  assert.equal(sunEvents(Date.UTC(2026, 11, 21), 69.65, 18.96).polar, 'night');
});

test('night intervals clip and chain across days', () => {
  const from = Date.UTC(2026, 8, 10, 0, 0);
  const to = Date.UTC(2026, 8, 12, 0, 0);
  const n = nightIntervals(from, to, 40.71, -74.01);
  assert.equal(n.length, 3);
  assert.equal(n[0][0], from);                                  // night in progress at start
  near(n[0][1], Date.UTC(2026, 8, 10, 10, 33), 8, 'first dawn');
  near(n[1][0], Date.UTC(2026, 8, 10, 23, 15), 8, 'dusk');
  near(n[1][1], Date.UTC(2026, 8, 11, 10, 34), 8, 'second dawn');
  assert.equal(n[2][1], to);                                    // clipped at the end
  // whole window inside a polar night → one full-span interval
  const pn = nightIntervals(Date.UTC(2026, 11, 20), Date.UTC(2026, 11, 22), 69.65, 18.96);
  assert.deepEqual(pn, [[Date.UTC(2026, 11, 20), Date.UTC(2026, 11, 22)]]);
  // midnight sun → no night at all
  assert.deepEqual(nightIntervals(Date.UTC(2026, 5, 20), Date.UTC(2026, 5, 22), 69.65, 18.96), []);
});

test('duration parsing', () => {
  assert.equal(parseDuration('8:35'), 515);
  assert.equal(parseDuration('8+35'), 515);
  assert.equal(parseDuration('0835'), 515);
  assert.equal(parseDuration('835'), 515);
  assert.equal(parseDuration('12:00'), 720);
  assert.equal(parseDuration('45'), 45);
  assert.equal(parseDuration('0:05'), 5);
  assert.equal(parseDuration('8:60'), null);
  assert.equal(parseDuration('0'), null);
  assert.equal(parseDuration('0:00'), null);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('abc'), null);
});

test('copy text: header, times first (local, then Zulu) with weekday, names trail', () => {
  const takeoff = makeUtcInstant(2026, 254, 5, 30); // FRI 11 SEP 2026 0530Z
  const text = buildCopyText(takeoff, [
    { name: 'Takeoff', ms: takeoff },
    { name: 'Brief', ms: takeoff - 180 * 60_000 },
  ], ['America/New_York']);
  assert.equal(text, [
    'Local: New York (EDT)',
    '2230L (THU)  0230Z (FRI)  Brief',
    '0130L (FRI)  0530Z (FRI)  TAKEOFF',
  ].join('\n'));
});

test('copy text: zones without a real abbreviation show their UTC offset', () => {
  const takeoff = makeUtcInstant(2026, 252, 20, 2); // WED 09 SEP 2026 2002Z
  const text = buildCopyText(takeoff, [
    { name: 'Takeoff', ms: takeoff },
    { name: 'Stop drink', ms: takeoff - 720 * 60_000 },
    { name: 'Landing', ms: takeoff + 500 * 60_000 },
  ], ['Asia/Dubai']);
  assert.equal(text, [
    'Local: Dubai (UTC+4)',
    '1202L (WED)  0802Z (WED)  Stop drink',
    '0002L (THU)  2002Z (WED)  TAKEOFF',
    '0822L (THU)  0422Z (THU)  LANDING',
  ].join('\n'));
  // Guam has one
  assert.equal(buildCopyText(takeoff, [{ name: 'Takeoff', ms: takeoff }], ['Pacific/Guam']),
    'Local: Guam (ChST)\n0602L (THU)  2002Z (WED)  TAKEOFF');
});

test('copy text without Zulu: local column only', () => {
  const takeoff = makeUtcInstant(2026, 254, 0, 30); // 0030Z FRI; New York THU evening
  const events = [{ name: 'Takeoff', ms: takeoff }, { name: 'Brief', ms: takeoff - 60 * 60_000 }];
  assert.equal(buildCopyText(takeoff, events, ['America/New_York'], { zulu: false }), [
    'Local: New York (EDT)',
    '1930L (THU)  Brief',
    '2030L (THU)  TAKEOFF',
  ].join('\n'));
});

test('duration entry is tidied to HH:MM as it is typed', () => {
  assert.equal(formatDurationEntry('8'), '8');
  assert.equal(formatDurationEntry('83'), '83');
  assert.equal(formatDurationEntry('835'), '8:35');
  assert.equal(formatDurationEntry('0835'), '08:35');
  assert.equal(formatDurationEntry('08:3'), '0:83');   // after a backspace
  assert.equal(formatDurationEntry('12:345'), '12:34');
  assert.equal(formatDurationEntry('8h35'), '8:35');
  assert.equal(formatDurationEntry(''), '');
  // finished entries are padded, and read the same as the bare digits
  assert.equal(formatDurationEntry('835', true), '08:35');
  assert.equal(formatDurationEntry('45', true), '00:45');
  assert.equal(formatDurationEntry('8', true), '00:08');
  assert.equal(formatDurationEntry('', true), '');
  for (const typed of ['835', '45', '8', '1200']) {
    assert.equal(parseDuration(formatDurationEntry(typed, true)), parseDuration(typed));
  }
});

test('offset entry: bare digits, the last two are minutes', () => {
  assert.equal(parseOffsetEntry('315'), 195);
  assert.equal(parseOffsetEntry('3:15'), 195);
  assert.equal(parseOffsetEntry('45'), 45);
  assert.equal(parseOffsetEntry('5'), 5);
  assert.equal(parseOffsetEntry('1600'), 960);
  assert.equal(parseOffsetEntry('16:00'), 960);
  assert.equal(parseOffsetEntry('0'), 0);
  assert.equal(parseOffsetEntry('0:00'), 0);
  assert.equal(parseOffsetEntry('112:45'), 6765);
  assert.equal(parseOffsetEntry('90'), null);      // 90 minutes is written 1:30
  assert.equal(parseOffsetEntry('2:75'), null);
  assert.equal(parseOffsetEntry(''), null);
  assert.equal(parseOffsetEntry('-3:15'), null);   // the sign is chosen separately
  assert.equal(parseOffsetEntry('abc'), null);
  // what is shown after typing reads back the same
  for (const min of [0, 5, 45, 195, 960, 6765]) {
    assert.equal(parseOffsetEntry(minutesToHMM(min)), min);
  }
});

test('events take their time from takeoff, landing or another event', () => {
  const MIN = 60_000;
  const takeoff = Date.UTC(2026, 9, 7, 18, 0);
  const landing = takeoff + 515 * MIN;
  const events = [
    { id: 'duty', source: 'show', offsetMin: 960 },       // listed before its source
    { id: 'show', source: 'takeoff', offsetMin: -195 },
    { id: 'brief', source: 'show', offsetMin: 30 },
    { id: 'debrief', source: 'landing', offsetMin: 45 },
    { id: 'done', source: 'debrief', offsetMin: 60 },
  ];
  const t = resolveEventTimes(events, takeoff, landing);
  assert.equal(t.get('show'), takeoff - 195 * MIN);
  assert.equal(t.get('brief'), takeoff - 165 * MIN);
  assert.equal(t.get('duty'), takeoff + 765 * MIN);
  assert.equal(t.get('debrief'), landing + 45 * MIN);
  assert.equal(t.get('done'), landing + 105 * MIN);

  // without a landing, only what hangs off it is left open
  const open = resolveEventTimes(events, takeoff, null);
  assert.equal(open.get('show'), takeoff - 195 * MIN);
  assert.equal(open.get('duty'), takeoff + 765 * MIN);
  assert.equal(open.get('debrief'), null);
  assert.equal(open.get('done'), null);
  assert.equal(resolveEventTimes(events, takeoff).get('debrief'), null);
});

test('events that loop or point nowhere get no time', () => {
  const takeoff = Date.UTC(2026, 9, 7, 18, 0);
  const t = resolveEventTimes([
    { id: 'a', source: 'b', offsetMin: 10 },
    { id: 'b', source: 'a', offsetMin: 10 },
    { id: 'self', source: 'self', offsetMin: 5 },
    { id: 'lost', source: 'gone', offsetMin: 5 },
    { id: 'after-a', source: 'a', offsetMin: 5 },
    { id: 'ok', source: 'takeoff', offsetMin: -60 },
  ], takeoff, takeoff + 1);
  for (const id of ['a', 'b', 'self', 'lost', 'after-a']) assert.equal(t.get(id), null);
  assert.equal(t.get('ok'), takeoff - 3_600_000);
});

test('eventDependsOn follows the chain of sources', () => {
  const events = [
    { id: 'show', source: 'takeoff', offsetMin: -195 },
    { id: 'brief', source: 'show', offsetMin: 30 },
    { id: 'step', source: 'brief', offsetMin: 60 },
    { id: 'debrief', source: 'landing', offsetMin: 45 },
  ];
  assert.equal(eventDependsOn(events, 'brief', 'show'), true);
  assert.equal(eventDependsOn(events, 'step', 'show'), true);    // through brief
  assert.equal(eventDependsOn(events, 'show', 'step'), false);
  assert.equal(eventDependsOn(events, 'debrief', 'show'), false);
  assert.equal(eventDependsOn(events, 'show', 'show'), false);
  // so "show" may not take "step" as its source: that would close a loop
  const looped = events.map((e) => (e.id === 'show' ? { ...e, source: 'step' } : e));
  assert.equal(eventDependsOn(looped, 'show', 'show'), true);
  assert.equal(eventDependsOn(looped, 'debrief', 'debrief'), false);
  // a loop elsewhere in the chain ends the search
  assert.equal(eventDependsOn(looped, 'brief', 'debrief'), false);
});
