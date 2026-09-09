# Aircrew Time Tool

A one-screen utility for flight crews: take the Julian day + Zulu takeoff time from dispatch, see it in any time zone, back-calculate your pre-takeoff events (brief, show, step, start…), and copy the whole timeline as text to paste into any messaging app.

**Live app:** https://jessehaycraft.github.io/aircrew-time-tool/

## Status

v0.2.5 — early field testing. Found a wrong time or a rough edge? [Open an issue](../../issues).

## Features (v0.1)

- Julian day + Zulu time in; the resolved calendar date is always shown as a sanity check (the year is inferred as the nearest upcoming occurrence of that day)
- Or toggle to a calendar date picker (defaults to today); the Julian day is then shown as the sanity check
- Takeoff time entered as Zulu or as local time in the selected zone (toggle); local entry converts DST-correctly
- Local times in your device's time zone by default — searchable zone picker (city, zone name, abbreviation, or offset), DST-correct as of the event date
- Named event templates saved on your device — create, edit, duplicate, delete; takeoff (0:00) is always included; ships with a "Standard" template (Stop drink T−12:00, LFA T−4:15, Bus T−3:15)
- Events that fall on a different day are flagged with the weekday, e.g. `1730Z (THU 10)` / `1330L (THU 10)`
- One-tap copy of the whole sequence of events as plain text
- No accounts, no server, no tracking — everything is computed on-device

## Example output

```
T/O FRI 11 SEP 26: 0530Z / 0130 EDT
STOP DRINK: 1730Z (THU 10) / 1330 EDT (THU 10)
LFA: 0115Z / 2115 EDT (THU 10)
BUS: 0215Z / 2215 EDT (THU 10)
TAKEOFF: 0530Z / 0130 EDT
```

## Roadmap

- Template sharing via copyable text codes (no server needed)
- Installable PWA with full offline support; then iOS/Android apps via Capacitor

## Development

No build step. Clone the repo and open `index.html`, or serve the folder with any static server.

All time math lives in `js/time-engine.js` (pure functions, no DOM). Run its tests with:

```sh
node --test tests/*.test.js
```
