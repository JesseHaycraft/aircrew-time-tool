import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLeapYear, daysInYear, dayOfYearUtc, parseTimeHHMM, parseJulianDay,
  parseOffset, offsetToHMM, resolveJulianYear, makeUtcInstant,
  zonedParts, isValidZone, buildCopyText,
  zoneLabel, utcOffsetLabel, longZoneName, zoneDisplayName,
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
    'T/O DAY 254 (FRI 11 SEP 26): 0530Z / 0130 EDT',
    'BRIEF: 0230Z / 2230 EDT (THU 10)',
    'TAKEOFF: 0530Z / 0130 EDT',
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
  assert.equal(text.split('\n')[0], 'T/O DAY 254 (FRI 11 SEP 26): 0530Z / 1530 Guam');
  assert.equal(text.split('\n')[1], 'TAKEOFF: 0530Z / 1530 Guam');
});

test('copy text: Zulu rollover shows the Julian day', () => {
  const takeoff = makeUtcInstant(2026, 254, 1, 30);
  const text = buildCopyText(takeoff, [{ name: 'Brief', offsetMin: -240 }], []);
  assert.equal(text.split('\n')[1], 'BRIEF: 253/2130Z');
});
