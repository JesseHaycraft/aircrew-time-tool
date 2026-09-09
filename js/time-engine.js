// Pure time math for the Aircrew Time Tool.
// No DOM access — everything here runs unchanged in Node for unit tests.

const MS_PER_DAY = 86_400_000;

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInYear(year) {
  return isLeapYear(year) ? 366 : 365;
}

// Day-of-year (1-366) for a UTC timestamp.
export function dayOfYearUtc(ms) {
  const d = new Date(ms);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((midnight - Date.UTC(d.getUTCFullYear(), 0, 1)) / MS_PER_DAY) + 1;
}

// "0530", "530", "05:30" → {h, m}; null if not a valid 24-hour time.
export function parseTimeHHMM(input) {
  const digits = String(input).trim().replace(':', '');
  if (!/^\d{3,4}$/.test(digits)) return null;
  const padded = digits.padStart(4, '0');
  const h = Number(padded.slice(0, 2));
  const m = Number(padded.slice(2));
  if (h > 23 || m > 59) return null;
  return { h, m };
}

export function parseJulianDay(input) {
  const s = String(input).trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const doy = Number(s);
  if (doy < 1 || doy > 366) return null;
  return doy;
}

// Event offset entry: "2:30", "-2:30", "+45", "-45" → signed minutes.
// A plain number is minutes; H:MM is hours and minutes.
export function parseOffset(input) {
  const s = String(input).trim();
  let m = s.match(/^([+-]?)(\d{1,2}):([0-5]\d)$/);
  if (m) return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  m = s.match(/^([+-]?)(\d{1,4})$/);
  if (m) return (m[1] === '-' ? -1 : 1) * Number(m[2]);
  return null;
}

// Signed minutes → "-2:30" / "+0:45" / "0:00".
export function offsetToHMM(minutes) {
  const sign = minutes < 0 ? '-' : minutes > 0 ? '+' : '';
  const abs = Math.abs(minutes);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

// Pick the year a bare day-of-year refers to: the nearest occurrence that is
// not more than graceDays in the past. Skips years where the day doesn't
// exist (day 366 outside leap years). Returns null if nothing matches.
export function resolveJulianYear(doy, nowMs, graceDays = 2) {
  const now = new Date(nowMs);
  const todayMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const cutoff = todayMidnight - graceDays * MS_PER_DAY;
  for (let y = now.getUTCFullYear(); y <= now.getUTCFullYear() + 8; y++) {
    if (doy > daysInYear(y)) continue;
    if (Date.UTC(y, 0, doy) >= cutoff) return y;
  }
  return null;
}

// Absolute instant for year + day-of-year + Zulu time.
export function makeUtcInstant(year, doy, h, m) {
  return Date.UTC(year, 0, doy, h, m); // day-of-month overflow normalizes doy
}

const partFormatters = new Map();

function formatterFor(zone) {
  let f = partFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      timeZoneName: 'short',
    });
    partFormatters.set(zone, f);
  }
  return f;
}

export function isValidZone(zone) {
  try {
    formatterFor(zone);
    return true;
  } catch {
    return false;
  }
}

// Wall-clock parts of an absolute instant in a zone. Formatting an absolute
// instant is always DST-safe: the offset in effect on the event's date is used.
export function zonedParts(ms, zone) {
  const parts = {};
  for (const p of formatterFor(zone).formatToParts(ms)) parts[p.type] = p.value;
  return {
    hhmm: `${parts.hour}${parts.minute}`,
    weekday: parts.weekday.toUpperCase(),
    day: parts.day,
    month: parts.month.toUpperCase(),
    year: parts.year,
    zoneAbbr: parts.timeZoneName.replace(/\s/g, ''),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

// Plain-text timeline for pasting into messaging apps. Proportional fonts
// mangle space-aligned columns, so lines are label-first and short.
export function buildCopyText(takeoffMs, events, zones) {
  const toDoy = dayOfYearUtc(takeoffMs);
  const z = zonedParts(takeoffMs, 'UTC');
  const takeoffCols = [
    `${z.hhmm}Z`,
    ...zones.map((zone) => {
      const p = zonedParts(takeoffMs, zone);
      return `${p.hhmm} ${p.zoneAbbr}`;
    }),
  ];
  const lines = [
    `T/O DAY ${String(toDoy).padStart(3, '0')} (${z.weekday} ${z.day} ${z.month} ${z.year.slice(2)}): ${takeoffCols.join(' / ')}`,
  ];
  const sorted = [...events].sort((a, b) => a.offsetMin - b.offsetMin);
  for (const ev of sorted) {
    const ms = takeoffMs + ev.offsetMin * 60_000;
    const evZ = zonedParts(ms, 'UTC');
    const evDoy = dayOfYearUtc(ms);
    const cols = [
      evDoy === toDoy ? `${evZ.hhmm}Z` : `${String(evDoy).padStart(3, '0')}/${evZ.hhmm}Z`,
    ];
    for (const zone of zones) {
      const p = zonedParts(ms, zone);
      const tp = zonedParts(takeoffMs, zone);
      const flag = p.dateKey === tp.dateKey ? '' : ` (${p.weekday} ${Number(p.day)})`;
      cols.push(`${p.hhmm} ${p.zoneAbbr}${flag}`);
    }
    lines.push(`${ev.name.toUpperCase()}: ${cols.join(' / ')}`);
  }
  return lines.join('\n');
}
