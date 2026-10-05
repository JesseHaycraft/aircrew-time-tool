// Reviews a freshly built data/tzdata.json against the previous one and
// writes the summary a person reads before approving the update.
//
//   node tools/tzdata/review.mjs --previous <file> [--data <file>]
//        [--reference <file>] [--write] [--rebase]
//
// It lists what changed between the two files, then compares the new file
// with the JavaScript runtime's own zone rules (reference.mjs). A runtime
// on an older tz release may only differ from the file
//   - where tests/reference-differences.json already says it does, or
//   - in a zone this very update changed.
// Any other difference means the build went wrong: it is reported and
// the exit code is 1. With --write, the reference list is brought up to
// date (new differences added, ones no longer seen dropped). --rebase
// skips the rule and rewrites the list from scratch, for use after
// moving to a runtime on a different tz release.
//
// The summary (Markdown) goes to standard output.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareWithRuntime, covers, dataType } from './reference.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? resolve(args[i + 1]) : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const previousFile = option('previous', null);
if (!previousFile) {
  console.error('usage: review.mjs --previous <file> [--data <file>] [--reference <file>] [--write] [--rebase]');
  process.exit(2);
}
const dataFile = option('data', join(root, 'data', 'tzdata.json'));
const referenceFile = option('reference', join(root, 'tests', 'reference-differences.json'));

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const previous = readJson(previousFile);
const data = readJson(dataFile);
const reference = readJson(referenceFile);

const pad2 = (n) => String(n).padStart(2, '0');
const isoDay = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
const isoMinute = (sec) => `${new Date(sec * 1000).toISOString().slice(0, 16).replace('T', ' ')}Z`;
function offsetText(sec) {
  const abs = Math.abs(sec);
  const m = Math.floor((abs % 3600) / 60);
  return `UTC${sec < 0 ? '-' : '+'}${Math.floor(abs / 3600)}${m ? `:${pad2(m)}` : ''}`;
}
const typeText = (t) => (/^[+-]\d/.test(t[1]) ? offsetText(t[0]) : `${offsetText(t[0])} (${t[1]})`);

// ---- what changed between the two files ----
// Per zone, the stretches of time where the offset or abbreviation in the
// new file differs from the old one, within the years both files cover.

const from = Math.max(previous.from, data.from);
const until = Math.min(previous.until, data.until);

function changedStretches(a, b) {
  const points = [...new Set([from, ...a.at, ...b.at])].filter((s) => s >= from && s < until).sort((x, y) => x - y);
  const stretches = [];
  let open = null;
  points.forEach((start, i) => {
    const was = dataType(start, a);
    const now = dataType(start, b);
    const end = points[i + 1] ?? until;
    if (was[0] === now[0] && was[1] === now[1]) { open = null; return; }
    if (open) { open.end = end; open.parts++; return; }
    open = { start, end, parts: 1, was, now };
    stretches.push(open);
  });
  return stretches;
}

const changed = new Map();   // zone → stretches
for (const [name, z] of Object.entries(data.zones)) {
  if (!Object.hasOwn(previous.zones, name)) continue;
  const stretches = changedStretches(previous.zones[name], z);
  if (stretches.length) changed.set(name, stretches);
}
const names = (o) => Object.keys(o);
const addedZones = names(data.zones).filter((n) => !Object.hasOwn(previous.zones, n));
const removedZones = names(previous.zones).filter((n) => !Object.hasOwn(data.zones, n));
const addedLinks = names(data.links).filter((n) => !Object.hasOwn(previous.links, n) && !removedZones.includes(n));
const removedLinks = names(previous.links).filter((n) => !Object.hasOwn(data.links, n) && !addedZones.includes(n));
const movedLinks = names(data.links).filter((n) =>
  Object.hasOwn(previous.links, n) && previous.links[n] !== data.links[n]);
// zones whose rules a link now takes from somewhere else count as changed
const touched = new Set([...changed.keys(), ...addedZones, ...movedLinks.map((n) => data.links[n]),
  ...removedZones.filter((n) => Object.hasOwn(data.links, n)).map((n) => data.links[n])]);

function describeStretch(s) {
  const span = s.end >= until ? 'onward' : `until ${isoMinute(s.end)}`;
  const more = s.parts > 1 ? `; old and new rules differ in ${s.parts} periods across that span` : '';
  return `from ${isoMinute(s.start)} ${span}: ${typeText(s.was)} becomes ${typeText(s.now)}${more}`;
}

// ---- comparison with the runtime ----

const runtimeTz = process.versions.tz;
const listed = flag('rebase') ? [] : (Array.isArray(reference[runtimeTz]) ? reference[runtimeTz] : []);
const { compared, differences } = compareWithRuntime(data);

const byZone = new Map();   // zone → { first, last }
for (const d of differences) {
  const z = byZone.get(d.zone) ?? { first: d.sec, last: d.sec };
  z.first = Math.min(z.first, d.sec);
  z.last = Math.max(z.last, d.sec);
  byZone.set(d.zone, z);
}

const unexplained = flag('rebase') ? [] : differences.filter((d) =>
  !listed.some((e) => covers(e, d.zone, d.sec)) && !touched.has(d.zone));
if (runtimeTz === data.version && differences.length) unexplained.push(...differences);

// The list as it should now read: kept entries that still cover what is
// seen, widened or new entries where they don't, nothing for zones that
// no longer differ.
const nextList = [];
const newEntries = [];
for (const [zone, seen] of [...byZone].sort((a, b) => a[0].localeCompare(b[0]))) {
  const mine = differences.filter((d) => d.zone === zone);
  const kept = listed.filter((e) => e.zone === zone && mine.some((d) => covers(e, zone, d.sec)));
  if (kept.length && mine.every((d) => kept.some((e) => covers(e, zone, d.sec)))) {
    nextList.push(...kept);
    continue;
  }
  const entry = {
    zone,
    from: isoDay(seen.first),
    // open-ended when the differences run up to the end of the data
    until: seen.last >= data.until - 14 * 86_400 ? null : isoDay(seen.last + 86_400),
    why: `changed in tz ${data.version}; confirm against the release notes`,
  };
  nextList.push(entry);
  newEntries.push(entry);
}
const droppedEntries = listed.filter((e) => !nextList.includes(e));

// ---- release notes ----

async function releaseNotes() {
  if (previous.version >= data.version) return null;
  try {
    const res = await fetch('https://data.iana.org/time-zones/tzdb/NEWS');
    if (!res.ok) return null;
    const out = [];
    let keepRelease = false;
    let keepSection = false;
    for (const line of (await res.text()).split('\n')) {
      const release = /^Release (\S+) - /.exec(line);
      if (release) {
        keepRelease = release[1] > previous.version && release[1] <= data.version;
        keepSection = false;
        if (keepRelease) out.push('', line);
        continue;
      }
      if (!keepRelease) continue;
      if (/^ {2}\S/.test(line)) keepSection = /^ {2}(Briefly|Changes to .*(timestamps|abbreviations))/.test(line);
      if (keepSection) out.push(line);
    }
    return out.join('\n').trim() || null;
  } catch {
    return null;
  }
}

// ---- the summary ----

const lines = [];
lines.push(`## Time zone data ${previous.version} → ${data.version}`, '');
if (previous.until !== data.until) {
  lines.push(`Coverage now runs through ${new Date(data.until * 1000 - 1).getUTCFullYear()} `
    + `(was ${new Date(previous.until * 1000 - 1).getUTCFullYear()}).`, '');
}

lines.push('### What changes for users', '');
if (!touched.size && !removedZones.length && !addedLinks.length && !removedLinks.length) {
  lines.push('No zone gives a different time or name than before.', '');
} else {
  for (const [name, stretches] of [...changed].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- \`${name}\``);
    for (const s of stretches.slice(0, 4)) lines.push(`  - ${describeStretch(s)}`);
    if (stretches.length > 4) lines.push(`  - …and ${stretches.length - 4} more changed stretches`);
  }
  for (const n of addedZones) lines.push(`- \`${n}\`: new zone`);
  for (const n of removedZones) {
    lines.push(`- \`${n}\`: no longer a zone of its own${Object.hasOwn(data.links, n) ? `; now follows \`${data.links[n]}\`` : ''}`);
  }
  for (const n of movedLinks) lines.push(`- \`${n}\`: now follows \`${data.links[n]}\` (was \`${previous.links[n]}\`)`);
  for (const n of addedLinks) lines.push(`- \`${n}\`: new old-name link to \`${data.links[n]}\``);
  for (const n of removedLinks) lines.push(`- \`${n}\`: old-name link removed`);
  lines.push('');
}

lines.push('### Check against an independent implementation', '');
lines.push(`${compared.toLocaleString('en-US')} comparisons against this runtime's own zone rules (tz ${runtimeTz}).`, '');
if (unexplained.length) {
  lines.push('**Unexplained differences — this build should not be published:**', '');
  for (const d of unexplained.slice(0, 20)) {
    lines.push(`- \`${d.name}\` at ${isoMinute(d.sec)}: file ${offsetText(d.ours)}, runtime ${offsetText(d.theirs)}`);
  }
  if (unexplained.length > 20) lines.push(`- …and ${unexplained.length - 20} more`);
  lines.push('');
} else if (!byZone.size) {
  lines.push('The file and the runtime agree everywhere.', '');
} else {
  lines.push(`They differ in ${byZone.size} zone${byZone.size === 1 ? '' : 's'}, all accounted for:`, '');
  for (const e of nextList) {
    const tag = newEntries.includes(e) ? '**new with this update**' : 'already listed';
    lines.push(`- \`${e.zone}\` from ${e.from}${e.until ? ` until ${e.until}` : ' onward'} — ${tag}: ${e.why}`);
  }
  for (const e of droppedEntries) lines.push(`- \`${e.zone}\` no longer differs; removed from the list`);
  lines.push('');
}

const notes = await releaseNotes();
lines.push('### IANA release notes', '');
lines.push(notes ? `\`\`\`\n${notes}\n\`\`\`` : '_Not included (same or older release, or the notes could not be fetched)._', '');
console.log(lines.join('\n'));

if (unexplained.length) process.exit(1);

if (flag('write') && (newEntries.length || droppedEntries.length || flag('rebase'))) {
  reference[runtimeTz] = nextList;
  const body = Object.entries(reference).map(([key, value]) => {
    if (!Array.isArray(value)) return `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
    return `  ${JSON.stringify(key)}: [\n${value.map((e) => `    ${JSON.stringify(e)}`).join(',\n')}\n  ]`;
  });
  writeFileSync(referenceFile, `{\n${body.join(',\n')}\n}\n`);
}
