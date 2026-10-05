// Builds data/tzdata.json from an IANA tz release.
//
//   node tools/tzdata/build.mjs [version] [output file]
//     version      an IANA release such as 2026e (default: latest)
//     output file  default: data/tzdata.json
//
// Stage 1 (build-dump.sh) needs a POSIX system with cc, make, curl and gpg.
// On Linux it runs directly; elsewhere it runs in a Docker container.
// Stage 2 (convert.mjs) turns its text output into the JSON file.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDump, parseSources, buildData, stringifyData } from './convert.mjs';

const FROM_YEAR = 1970;       // the tz database only aims to be reliable from here on
const YEARS_AHEAD = 10;       // full calendar years covered beyond the build year

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const workDir = join(here, '.work');
const version = process.argv[2] ?? 'latest';
const now = new Date();
const untilYear = now.getUTCFullYear() + YEARS_AHEAD + 1;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} exited with ${r.status}`);
}

const stageArgs = [version, String(FROM_YEAR), String(untilYear)];
if (process.platform === 'linux') {
  run('sh', [join(here, 'build-dump.sh'), ...stageArgs, workDir]);
} else {
  run('docker', [
    'run', '--rm', '-v', `${here}:/tz`, 'alpine:3', 'sh', '-c',
    `apk add --no-cache build-base curl gnupg >/dev/null && sh /tz/build-dump.sh ${stageArgs.join(' ')} /tz/.work`,
  ]);
}

const data = buildData({
  dump: parseDump(readFileSync(join(workDir, 'dump.txt'), 'utf8')),
  sources: parseSources(readFileSync(join(workDir, 'sources.txt'), 'utf8')),
  version: readFileSync(join(workDir, 'version'), 'utf8').trim(),
  built: now.toISOString().slice(0, 10),
  fromYear: FROM_YEAR,
  untilYear,
});

const outFile = process.argv[3] ? resolve(process.argv[3]) : join(root, 'data', 'tzdata.json');
mkdirSync(dirname(outFile), { recursive: true });
const text = stringifyData(data);
writeFileSync(outFile, text);
console.log(
  `wrote ${outFile}: tz ${data.version}, ${Object.keys(data.zones).length} zones, `
  + `${Object.keys(data.links).length} links, ${FROM_YEAR}–${untilYear - 1}, ${(text.length / 1024).toFixed(0)} KB`,
);
