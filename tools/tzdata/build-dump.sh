#!/bin/sh
# Stage 1 of the zone-data build (needs a POSIX system with cc, make, curl).
# Downloads one IANA tz release, builds IANA's own zic and zdump from it,
# compiles every zone and dumps each zone's transitions as text, so the
# rule compilation and the far-future projection are both done by the
# reference code rather than by anything of ours.
#
# Usage: build-dump.sh VERSION FROM_YEAR UNTIL_YEAR OUT_DIR
#   VERSION     an IANA release such as 2026e, or "latest"
#   FROM_YEAR   first year covered (inclusive)
#   UNTIL_YEAR  first year not covered (exclusive)
#   OUT_DIR     receives dump.txt, sources.txt and version
set -eu

version=$1
from=$2
until=$3
out=$4

base=https://data.iana.org/time-zones
work=$(mktemp -d)
cd "$work"

if [ "$version" = latest ]; then
  curl -fsSL -o tzcode.tar.gz "$base/tzcode-latest.tar.gz"
  curl -fsSL -o tzdata.tar.gz "$base/tzdata-latest.tar.gz"
else
  curl -fsSL -o tzcode.tar.gz "$base/releases/tzcode$version.tar.gz"
  curl -fsSL -o tzdata.tar.gz "$base/releases/tzdata$version.tar.gz"
fi
tar -xzf tzcode.tar.gz
tar -xzf tzdata.tar.gz

make -s zic zdump >/dev/null

# The standard set of source files; "backward" carries the old-name links.
sources="africa antarctica asia australasia etcetera europe northamerica southamerica backward"
./zic -d "$work/zoneinfo" $sources

mkdir -p "$out"
cat $sources > "$out/sources.txt"
cp version "$out/version"

: > "$out/dump.txt"
for zone in $(awk '$1 == "Zone" { print $2 }' $sources); do
  ./zdump -i -c "$from,$until" "$work/zoneinfo/$zone" >> "$out/dump.txt"
done

echo "dumped $(grep -c '^TZ=' "$out/dump.txt") zones from tz $(cat version)"
