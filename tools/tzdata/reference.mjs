// Compares a zone-data file with the JavaScript runtime's own zone rules.
// The runtime compiles the same IANA source with different code (ICU), so
// agreement across every zone is strong evidence the file was built
// correctly. Used by the tests and by review.mjs.

const formatters = new Map();

// Seconds east of UTC that the runtime gives a zone at an instant.
export function runtimeOffset(sec, zone) {
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

// The [offset, abbreviation, isDst] a zone's rules give at an instant.
export function dataType(sec, z) {
  let lo = 0;
  let hi = z.at.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (z.at[mid] <= sec) lo = mid + 1;
    else hi = mid;
  }
  return z.types[lo === 0 ? z.start : z.to[lo - 1]];
}

const WEEK = 7 * 86_400;

// Every sampled instant where the file and the runtime disagree. Each
// zone is sampled on a weekly grid plus a minute either side of every
// transition; each old-name link on a four-weekly grid. `zone` is the
// zone whose rules were used (the link's target, for a link).
export function compareWithRuntime(data) {
  const differences = [];
  let compared = 0;
  const compare = (name, zone, z, sec) => {
    if (sec < data.from || sec >= data.until) return;
    compared++;
    const ours = dataType(sec, z)[0];
    const theirs = runtimeOffset(sec, name);
    if (ours !== theirs) differences.push({ name, zone, sec, ours, theirs });
  };
  const known = (name) => {
    try { runtimeOffset(0, name); return true; } catch { return false; }
  };
  for (const [name, z] of Object.entries(data.zones)) {
    if (!known(name)) continue;
    for (let sec = data.from + 3 * 3600 + 17 * 60; sec < data.until; sec += WEEK) compare(name, name, z, sec);
    for (const at of z.at) { compare(name, name, z, at - 60); compare(name, name, z, at + 60); }
  }
  for (const [link, target] of Object.entries(data.links)) {
    if (!known(link)) continue;
    for (let sec = data.from + 5 * 3600; sec < data.until; sec += 4 * WEEK) {
      compare(link, target, data.zones[target], sec);
    }
  }
  return { compared, differences };
}

const dayStart = (isoDate) => Date.parse(`${isoDate}T00:00:00Z`) / 1000;

// Whether a listed exception ({ zone, from, until }) covers a difference.
export function covers(entry, zone, sec) {
  return entry.zone === zone && sec >= dayStart(entry.from)
    && (entry.until === null || sec < dayStart(entry.until));
}
