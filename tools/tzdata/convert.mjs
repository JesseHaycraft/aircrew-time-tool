// Stage 2 of the zone-data build: turns the text that IANA's zdump wrote
// (stage 1, build-dump.sh) into the JSON file the apps read. Pure
// functions, no I/O — build.mjs does the reading and writing.

// "-08", "+0530", "-004430" → seconds east of UTC.
function parseUtOffset(text) {
  const m = /^([+-]?)(\d{2})(\d{2})?(\d{2})?$/.exec(text);
  if (!m) throw new Error(`unreadable UT offset "${text}"`);
  const sec = Number(m[2]) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
  return m[1] === '-' ? -sec : sec;
}

// "03", "01:30", "00:44:30" → seconds into the day.
function parseClock(text) {
  const m = /^(\d{2})(?::(\d{2}))?(?::(\d{2}))?$/.exec(text);
  if (!m) throw new Error(`unreadable time "${text}"`);
  return Number(m[1]) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

// An interval is "offset [abbreviation [isdst]]". zdump leaves the
// abbreviation out when it is just the offset again ("+0530"), and may
// quote it when it isn't purely alphabetic.
function parseInterval(fields) {
  const [offsetText, abbrText = '', dstText = ''] = fields;
  const abbr = abbrText.replace(/^"(.*)"$/, '$1') || offsetText;
  return { offset: parseUtOffset(offsetText), abbr, dst: Number(dstText) > 0 ? 1 : 0 };
}

// zdump -i output → Map of zone name → { initial, transitions }.
// Each zone is a `TZ="…/zoneinfo/Name"` line, one "- - interval" line for
// the state at the start of the range, then one line per transition:
// local date and time just after the change, and the new interval.
export function parseDump(text) {
  const zones = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const tz = /^TZ="(?:.*\/zoneinfo\/)?(.+)"$/.exec(line);
    if (tz) {
      if (zones.has(tz[1])) throw new Error(`zone ${tz[1]} dumped twice`);
      current = { initial: null, transitions: [] };
      zones.set(tz[1], current);
      continue;
    }
    if (!current) throw new Error(`line before any zone: "${line}"`);
    const f = line.split('\t');
    if (f[0] === '-' && f[1] === '-') {
      current.initial = parseInterval(f.slice(2));
      continue;
    }
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f[0]);
    if (!d) throw new Error(`unreadable date "${f[0]}"`);
    const interval = parseInterval(f.slice(2));
    const localSec = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])) / 1000 + parseClock(f[1]);
    current.transitions.push({ at: localSec - interval.offset, ...interval });
  }
  return zones;
}

// The tz source files → zone names and old-name links (link → zone, with
// chains of links followed to the zone at the end).
export function parseSources(text) {
  const zoneNames = new Set();
  const raw = new Map();
  for (const line of text.split('\n')) {
    const tokens = line.replace(/#.*/, '').trim().split(/\s+/);
    if (tokens[0] === 'Zone') zoneNames.add(tokens[1]);
    else if (tokens[0] === 'Link') raw.set(tokens[2], tokens[1]);
  }
  const links = new Map();
  for (const name of raw.keys()) {
    let target = raw.get(name);
    for (let hops = 0; raw.has(target); hops++) {
      if (hops > 10) throw new Error(`link loop at ${name}`);
      target = raw.get(target);
    }
    if (!zoneNames.has(target)) throw new Error(`link ${name} points at unknown zone ${target}`);
    if (!zoneNames.has(name)) links.set(name, target);
  }
  return { zoneNames, links };
}

// Assemble the data file's object. Times are epoch seconds, offsets are
// seconds east of UTC. Per zone: `types` lists the distinct
// [offset, abbreviation, isDst] states, `start` is the state in force at
// `from`, and `at[i]` is the instant the zone switches to `types[to[i]]`.
export function buildData({ dump, sources, version, built, fromYear, untilYear }) {
  const from = Date.UTC(fromYear, 0, 1) / 1000;
  const until = Date.UTC(untilYear, 0, 1) / 1000;
  const zones = {};
  for (const name of [...sources.zoneNames].sort()) {
    const z = dump.get(name);
    if (!z || !z.initial) throw new Error(`zone ${name} is missing from the dump`);
    const types = [];
    const typeIndex = ({ offset, abbr, dst }) => {
      let i = types.findIndex((t) => t[0] === offset && t[1] === abbr && t[2] === dst);
      if (i < 0) i = types.push([offset, abbr, dst]) - 1;
      return i;
    };
    const start = typeIndex(z.initial);
    const at = [];
    const to = [];
    for (const t of z.transitions) {
      if (t.at < from || t.at >= until) throw new Error(`${name}: transition outside the range`);
      if (at.length && t.at <= at[at.length - 1]) throw new Error(`${name}: transitions out of order`);
      at.push(t.at);
      to.push(typeIndex(t));
    }
    zones[name] = { types, start, at, to };
  }
  for (const name of dump.keys()) {
    if (!sources.zoneNames.has(name)) throw new Error(`dumped zone ${name} is not in the sources`);
  }
  const links = {};
  for (const name of [...sources.links.keys()].sort()) links[name] = sources.links.get(name);
  return { format: 1, version, built, from, until, zones, links };
}

// JSON with one zone (and one link) per line, so a rule change shows up
// as a one-line difference between two versions of the file.
export function stringifyData(data) {
  const { zones, links, ...head } = data;
  const lines = ['{'];
  for (const [k, v] of Object.entries(head)) lines.push(`${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  lines.push('"zones": {');
  const zoneNames = Object.keys(zones);
  zoneNames.forEach((name, i) => {
    lines.push(`${JSON.stringify(name)}: ${JSON.stringify(zones[name])}${i < zoneNames.length - 1 ? ',' : ''}`);
  });
  lines.push('},', '"links": {');
  const linkNames = Object.keys(links);
  linkNames.forEach((name, i) => {
    lines.push(`${JSON.stringify(name)}: ${JSON.stringify(links[name])}${i < linkNames.length - 1 ? ',' : ''}`);
  });
  lines.push('}', '}', '');
  return lines.join('\n');
}
