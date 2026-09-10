import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLeapYear, daysInYear, dayOfYearUtc, parseTimeHHMM, parseJulianDay,
  parseOffset, offsetToHMM, resolveJulianYear, makeUtcInstant,
  zonedParts, isValidZone, buildCopyText,
  zoneLabel, utcOffsetLabel, longZoneName, zoneDisplayName, zoneWallToUtc,
  daySegments, formatCountdown, zoneRegionName, sunEvents, nightIntervals,
} from '../js/time-engine.js';

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
  assert.equal(offsetToHMM(-150), '-2:30');
  assert.equal(offsetToHMM(45), '+0:45');
  assert.equal(offsetToHMM(0), '0:00');
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

test('copy text: full timeline with day-change flags', () => {
  const takeoff = makeUtcInstant(2026, 254, 5, 30); // FRI 11 SEP 2026 0530Z
  const text = buildCopyText(takeoff, [
    { name: 'Takeoff', offsetMin: 0 },
    { name: 'Brief', offsetMin: -180 },
  ], ['America/New_York']);
  assert.equal(text, [
    'BRIEF: 0230Z (FRI 11) / 2230 EDT (THU 10)',
    'TAKEOFF: 0530Z (FRI 11) / 0130 EDT (FRI 11)',
  ].join('\n'));
});

test('zone names and UTC offsets', () => {
  const june = Date.UTC(2026, 5, 15);
  assert.equal(zoneLabel('America/New_York'), 'New York');
  assert.equal(zoneLabel('Pacific/Guam'), 'Guam');
  assert.equal(zoneDisplayName(june, 'America/New_York'), 'EDT');
  assert.equal(zoneDisplayName(june, 'Pacific/Guam'), 'Guam'); // short name is only GMT+10
  assert.equal(utcOffsetLabel(june, 'America/New_York'), 'UTC-4');
  assert.equal(utcOffsetLabel(Date.UTC(2026, 0, 15), 'America/New_York'), 'UTC-5');
  assert.equal(utcOffsetLabel(june, 'Asia/Kolkata'), 'UTC+5:30');
  assert.equal(utcOffsetLabel(june, 'UTC'), 'UTC+0');
  assert.equal(longZoneName(june, 'Pacific/Guam'), 'Chamorro Standard Time');
});

test('copy text uses zone names, never GMT offsets', () => {
  const takeoff = makeUtcInstant(2026, 254, 5, 30);
  const text = buildCopyText(takeoff, [{ name: 'Takeoff', offsetMin: 0 }], ['Pacific/Guam']);
  assert.equal(text, 'TAKEOFF: 0530Z / 1530 Guam');
});

test('copy text: multiple days present puts a day on every time', () => {
  const takeoff = makeUtcInstant(2026, 252, 20, 2); // WED 09 SEP 2026 2002Z
  const text = buildCopyText(takeoff, [
    { name: 'Takeoff', offsetMin: 0 },
    { name: 'Stop drink', offsetMin: -720 },
  ], ['Pacific/Guam']);
  assert.equal(text.split('\n')[0], 'STOP DRINK: 0802Z (WED 9) / 1802 Guam (WED 9)');
  assert.equal(text.split('\n')[1], 'TAKEOFF: 2002Z (WED 9) / 0602 Guam (THU 10)');
});

test('copy text: single-day sequences carry no flags at all', () => {
  const takeoff = makeUtcInstant(2026, 254, 12, 0); // FRI 11 SEP 1200Z
  const text = buildCopyText(takeoff, [
    { name: 'Takeoff', offsetMin: 0 },
    { name: 'Brief', offsetMin: -120 },
  ], ['Pacific/Guam']); // 1200Z→2200 local, 1000Z→2000 local, all FRI 11
  assert.equal(text, [
    'BRIEF: 1000Z / 2000 Guam',
    'TAKEOFF: 1200Z / 2200 Guam',
  ].join('\n'));
});

test('copy text: Zulu rollover shows the weekday', () => {
  const takeoff = makeUtcInstant(2026, 254, 1, 30);
  const text = buildCopyText(takeoff, [
    { name: 'Brief', offsetMin: -240 },
    { name: 'Takeoff', offsetMin: 0 },
  ], []);
  assert.equal(text, 'BRIEF: 2130Z (THU 10)\nTAKEOFF: 0130Z (FRI 11)');
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

test('region zone names', () => {
  const t = Date.UTC(2026, 8, 10);
  assert.equal(zoneRegionName(t, 'America/New_York'), 'America - Eastern');
  assert.equal(zoneRegionName(t, 'America/Phoenix'), 'America - Mountain');
  assert.equal(zoneRegionName(t, 'Pacific/Guam'), 'Pacific - Chamorro');
  assert.equal(zoneRegionName(t, 'Europe/London'), 'Europe - United Kingdom');
  assert.equal(zoneRegionName(t, 'Asia/Tokyo'), 'Asia - Japan');
  assert.equal(zoneRegionName(t, 'Pacific/Honolulu'), 'Pacific - Hawaii-Aleutian');
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
