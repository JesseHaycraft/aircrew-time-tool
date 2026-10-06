# Aircrew Time Tool

A phone-sized utility for flight crews: enter the takeoff from the frag, choose the local time zone, and get the whole sequence of events in local and Zulu time, ready to copy into any messaging app.

**Live app:** https://jessehaycraft.github.io/aircrew-time-tool/

## Status

v0.9.0 — early field testing. Found a wrong time or a rough edge? [Open an issue](../../issues).

## Features

- **Frag:** the takeoff as a Julian day (always a Zulu day) or a calendar date, in Zulu or local time; a Julian day is read back as its calendar day, flagged when it falls more than 30 days ahead. The local time zone, found by city, zone name, abbreviation or offset, or the device's own. An optional flight duration, which shows the landing in Zulu and local.
- **SOEs:** the sequence of events for the chosen template, each event with where its time comes from (`Takeoff − 3:15`, `Show + 16:00`) and its local and Zulu times; when the sequence crosses midnight, each time carries its day. Live countdowns on the events you choose.
- **Templates:** saved on the device; create, edit, duplicate, delete. Each event counts from takeoff, from landing or from another event, before or after it. The editor lists events in time order and opens one at a time.
- **Copy times:** the text exactly as it will be copied, one checkbox per line, with or without the Zulu column.
- **Convert:** per-zone day bars that drag together under a fixed line (1-minute precision, hour tick marks, DST-correct day widths), with any zones alongside Zulu; jumps to now, takeoff and landing.
- **About:** the version, the time zone data release in use and when it was last checked, with a button to check now.
- **Installable:** add it to the home screen from the browser menu and it opens like an app, instantly and without signal. A new version is fetched in the background and appears at the next launch.
- No accounts, no server, no tracking — everything is computed on the device.

## Example output

```
Local: Guam (ChST)
1600L (WED)  0600Z (WED)  Stop drink
2345L (WED)  1345Z (WED)  LFA
0045L (THU)  1445Z (WED)  Bus
0400L (THU)  1800Z (WED)  Takeoff
1235L (THU)  0235Z (THU)  Landing
```

## Roadmap

- Template sharing through copyable text codes (no server needed)
- Native iOS and Android apps

## Development

No build step. Clone the repo and open `index.html`, or serve the folder with any static server.

Time zone rules come from `data/tzdata.json`, which is built from the IANA tz database. The app converts with that file rather than with the device's own rules, so an out-of-date phone or browser still shows the right time; the device is only used for a zone or date the file doesn't cover, and the page says so when that happens. To rebuild the file for a new IANA release (needs Docker, except on Linux):

```sh
npm run build:tzdata
```

This normally happens by itself. A scheduled workflow (`.github/workflows/zone-data.yml`) checks IANA once a day; when a new release is out it verifies the release's signature, rebuilds the file, tests it, and opens a pull request describing which zones change. Merging the pull request publishes the data, and the app picks it up the next time it is opened online. A pull request left alone is merged automatically after seven days if the tests still pass.

`sw.js` keeps a copy of the app on the device for offline use; its version number, the `?v=` tags in `index.html` and the imports move together at each release. The icons in `icons/` are drawn by `node tools/make-icons.mjs`.

All time math lives in `js/time-engine.js` (pure functions, no DOM). Run its tests with:

```sh
npm test
```
