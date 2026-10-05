#!/bin/sh
# Stage 1 of the zone-data build (needs a POSIX system with cc, make, curl
# and gpg). Downloads one IANA tz release, checks the maintainer's
# signature on it, builds IANA's own zic and zdump from it, compiles every
# zone and dumps each zone's transitions as text, so the rule compilation
# and the far-future projection are both done by the reference code rather
# than by anything of ours.
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
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
cd "$work"

if [ "$version" = latest ]; then
  version=$(curl -fsSL "$base/tzdb/version")
fi
for part in tzcode tzdata; do
  curl -fsSL -o "$part.tar.gz" "$base/releases/$part$version.tar.gz"
  curl -fsSL -o "$part.tar.gz.asc" "$base/releases/$part$version.tar.gz.asc"
done

# Nothing from the download is unpacked or run until its signature checks
# out against the tz maintainer's key, pinned here by fingerprint (the key
# itself is in tz-signing-key.asc). A signature from that key counts even
# if the key's own expiry date has passed: published copies of the key
# lag behind its renewals, and the fingerprint is what is trusted.
# A revoked key, an expired signature or a bad signature does not.
signer=7E3792A9D8ACF7D633BC1588ED97E90E62AA7E34
GNUPGHOME=$(mktemp -d)
export GNUPGHOME
gpg --batch --quiet --import "$here/tz-signing-key.asc"
for part in tzcode tzdata; do
  status=$(gpg --batch --status-fd 1 --verify "$part.tar.gz.asc" "$part.tar.gz" 2>/dev/null || true)
  if ! echo "$status" | grep -q "^\[GNUPG:\] VALIDSIG .* $signer\$" \
    || ! echo "$status" | grep -Eq "^\[GNUPG:\] (GOODSIG|EXPKEYSIG) " \
    || echo "$status" | grep -Eq "^\[GNUPG:\] (BADSIG|ERRSIG|EXPSIG|REVKEYSIG) "; then
    echo "signature check failed for $part$version.tar.gz" >&2
    exit 1
  fi
done

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
