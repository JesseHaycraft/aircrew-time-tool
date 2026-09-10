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

// Minute-resolution countdown to an instant: "in 17hrs 18mins",
// "in 1day 5hrs", "7mins ago", or "now" within half a minute either
// side. Zero parts are dropped. Rounded, so a tick fired just after the
// minute boundary still reads a whole minute.
export function formatCountdown(targetMs, nowMs) {
  const diffMin = Math.round((targetMs - nowMs) / 60_000);
  if (diffMin === 0) return 'now';
  const abs = Math.abs(diffMin);
  const parts = [
    [Math.floor(abs / 1440), 'day'],
    [Math.floor((abs % 1440) / 60), 'hr'],
    [abs % 60, 'min'],
  ];
  const body = parts
    .filter(([n]) => n > 0)
    .map(([n, unit]) => `${n}${unit}${n === 1 ? '' : 's'}`)
    .join(' ');
  return diffMin > 0 ? `in ${body}` : `${body} ago`;
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

const formatterCache = new Map();

function formatterFor(zone, kind = 'parts') {
  const key = `${kind}|${zone}`;
  let f = formatterCache.get(key);
  if (!f) {
    const options = {
      parts: {
        timeZone: zone, hourCycle: 'h23',
        year: 'numeric', month: 'short', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
        weekday: 'short', timeZoneName: 'short',
      },
      offset: { timeZone: zone, timeZoneName: 'shortOffset' },
      long: { timeZone: zone, timeZoneName: 'long' },
      generic: { timeZone: zone, timeZoneName: 'longGeneric' },
      wall: {
        timeZone: zone, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      },
    }[kind];
    f = new Intl.DateTimeFormat('en-US', options);
    formatterCache.set(key, f);
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

function wallParts(ms, zone) {
  const parts = {};
  for (const p of formatterFor(zone, 'wall').formatToParts(ms)) parts[p.type] = p.value;
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute),
  };
}

// Wall-clock time in a zone → UTC instant, by iteratively correcting a
// guess until the zone shows the wanted wall time. DST edges are resolved
// deterministically: a fall-back time that occurs twice returns the earlier
// (pre-transition) instant; a spring-forward time that doesn't exist lands
// just past the gap. The displayed Zulu conversion is the user's check.
export function zoneWallToUtc(zone, year, month1, day, hour, minute) {
  const want = Date.UTC(year, month1 - 1, day, hour, minute);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = wallParts(guess, zone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    if (shown === want) break;
    guess += want - shown;
  }
  return guess;
}

// Local-day segments (midnight to midnight in the zone's wall clock, so
// 23/25 h around DST changes) covering [fromMs, toMs]. Labels are taken
// at midday, safely inside the day.
export function daySegments(zone, fromMs, toMs) {
  const midnightOf = (ms) => {
    const p = wallParts(ms, zone);
    return zoneWallToUtc(zone, p.year, p.month, p.day, 0, 0);
  };
  let start = midnightOf(fromMs);
  if (start > fromMs) start = midnightOf(fromMs - MS_PER_DAY);
  const segs = [];
  while (start < toMs && segs.length < 64) {
    const midday = start + 12 * 3_600_000;
    let end = midnightOf(start + 36 * 3_600_000);
    if (end <= start) end = start + MS_PER_DAY;
    const p = zonedParts(midday, zone);
    const wp = wallParts(midday, zone);
    const epochDay = Math.floor(Date.UTC(wp.year, wp.month - 1, wp.day) / MS_PER_DAY);
    segs.push({ start, end, weekday: p.weekday, day: p.day, month: p.month, epochDay });
    start = end;
  }
  return segs;
}

// "America/New_York" → "New York"
export function zoneLabel(zone) {
  return zone.split('/').pop().replaceAll('_', ' ');
}

// "America/New_York" → "America - Eastern", "Pacific/Guam" → "Pacific -
// Chamorro": the IANA region plus the zone's generic (non-DST) name with
// the "Time" / "Standard Time" tail dropped. Zones the platform has no
// generic name for ("GMT+10") fall back to the city.
export function zoneRegionName(ms, zone) {
  const region = zone.includes('/') ? zone.split('/')[0].replaceAll('_', ' ') : '';
  let generic = timeZonePart(ms, zone, 'generic')
    .replace(/\s+(Standard|Daylight|Summer)\s+Time$/i, '')
    .replace(/\s+Time$/i, '');
  if (!generic || /^(GMT|UTC)/.test(generic)) generic = zoneLabel(zone);
  return region ? `${region} - ${generic}` : generic;
}

// ---- sunrise / sunset (NOAA solar calculator equations) ----
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Sunrise and sunset (ms epoch) for the UTC calendar day starting at
// utcMidnightMs, seen from lat/lon. Polar day/night return { polar }.
// Uses the standard 90.833° zenith (refraction + solar radius).
export function sunEvents(utcMidnightMs, lat, lon) {
  const jc = (utcMidnightMs / MS_PER_DAY + 2440587.5 - 2451545) / 36525;
  const L0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const Mr = rad(M);
  const C = Math.sin(Mr) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
    + Math.sin(2 * Mr) * (0.019993 - 0.000101 * jc)
    + Math.sin(3 * Mr) * 0.000289;
  const omega = rad(125.04 - 1934.136 * jc);
  const lambda = rad(L0 + C - 0.00569 - 0.00478 * Math.sin(omega));
  const eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const eps = rad(eps0 + 0.00256 * Math.cos(omega));
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const y = Math.tan(eps / 2) ** 2;
  const L0r = rad(L0);
  const eqTime = 4 * deg(
    y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr)
    + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r)
    - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr),
  );
  const latr = rad(lat);
  const cosHA = Math.cos(rad(90.833)) / (Math.cos(latr) * Math.cos(decl)) - Math.tan(latr) * Math.tan(decl);
  if (cosHA > 1) return { polar: 'night' };
  if (cosHA < -1) return { polar: 'day' };
  const ha = deg(Math.acos(cosHA));
  const noonMin = 720 - 4 * lon - eqTime;
  return {
    sunrise: utcMidnightMs + (noonMin - 4 * ha) * 60_000,
    sunset: utcMidnightMs + (noonMin + 4 * ha) * 60_000,
  };
}

// Night-time spans [start, end] between fromMs and toMs at lat/lon:
// each sunset to the following sunrise, polar nights as whole days.
export function nightIntervals(fromMs, toMs, lat, lon) {
  const first = Math.floor(fromMs / MS_PER_DAY) - 1;
  const last = Math.floor(toMs / MS_PER_DAY) + 1;
  const ev = new Map();
  for (let d = first; d <= last + 1; d++) ev.set(d, sunEvents(d * MS_PER_DAY, lat, lon));
  const raw = [];
  for (let d = first; d <= last; d++) {
    const cur = ev.get(d);
    const next = ev.get(d + 1);
    if (cur.polar === 'night') { raw.push([d * MS_PER_DAY, (d + 1) * MS_PER_DAY]); continue; }
    if (cur.polar === 'day') continue;
    const end = next.sunrise ?? (next.polar === 'night' ? (d + 1) * MS_PER_DAY : cur.sunset);
    if (end > cur.sunset) raw.push([cur.sunset, end]);
  }
  raw.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of raw) {
    const cs = Math.max(s, fromMs);
    const ce = Math.min(e, toMs);
    if (ce <= cs) continue;
    const prev = out[out.length - 1];
    if (prev && cs <= prev[1]) prev[1] = Math.max(prev[1], ce);
    else out.push([cs, ce]);
  }
  return out;
}

function timeZonePart(ms, zone, kind) {
  const part = formatterFor(zone, kind).formatToParts(ms).find((p) => p.type === 'timeZoneName');
  return part ? part.value : '';
}

// "UTC-4", "UTC+5:30", "UTC+0" — as of the given instant, so DST-correct.
export function utcOffsetLabel(ms, zone) {
  const raw = timeZonePart(ms, zone, 'offset');
  return raw === 'GMT' ? 'UTC+0' : raw.replace('GMT', 'UTC');
}

// "Eastern Daylight Time", "Chamorro Standard Time"
export function longZoneName(ms, zone) {
  return timeZonePart(ms, zone, 'long');
}

// Short abbreviation when CLDR has one (EDT, CDT); city name when it
// would only be a GMT offset (Pacific/Guam → "Guam").
export function zoneDisplayName(ms, zone) {
  const abbr = zonedParts(ms, zone).zoneAbbr;
  return abbr.startsWith('GMT') || abbr.startsWith('UTC') ? zoneLabel(zone) : abbr;
}

// Plain-text timeline for pasting into messaging apps. Proportional fonts
// mangle space-aligned columns, so lines are label-first and short.
export function buildCopyText(takeoffMs, events, zones) {
  const sorted = [...events].sort((a, b) => a.offsetMin - b.offsetMin);
  const rows = sorted.map((ev) => {
    const ms = takeoffMs + ev.offsetMin * 60_000;
    return {
      ev,
      zp: zonedParts(ms, 'UTC'),
      locals: zones.map((zone) => ({ p: zonedParts(ms, zone), name: zoneDisplayName(ms, zone) })),
    };
  });

  // All-or-nothing day flags: as soon as more than one calendar day
  // appears anywhere in the output, every time states its day; when
  // everything shares one day, no flags at all.
  const dateKeys = new Set();
  for (const r of rows) {
    dateKeys.add(r.zp.dateKey);
    for (const l of r.locals) dateKeys.add(l.p.dateKey);
  }
  const showFlags = dateKeys.size > 1;
  const flag = (p) => (showFlags ? ` (${p.weekday} ${Number(p.day)})` : '');

  return rows.map((r) => {
    const cols = [
      `${r.zp.hhmm}Z${flag(r.zp)}`,
      ...r.locals.map((l) => `${l.p.hhmm} ${l.name}${flag(l.p)}`),
    ];
    return `${r.ev.name.toUpperCase()}: ${cols.join(' / ')}`;
  }).join('\n');
}
