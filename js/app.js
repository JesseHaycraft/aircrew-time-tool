import * as T from './time-engine.js';

const VERSION = 'v0.1.4';
const STORAGE_KEY = 'att-state-v1';
const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// Standard timeline, fixed until user-editable templates land.
const EVENTS = [
  { name: 'Stop drink', offsetMin: -720 }, // T-12:00
  { name: 'LFA', offsetMin: -255 },        // T-4:15
  { name: 'Bus', offsetMin: -195 },        // T-3:15
  { name: 'Takeoff', offsetMin: 0 },
];

let state = loadState();
let takeoffMs = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      // Older versions stored a zones array; keep the first entry.
      const zone =
        typeof s.zone === 'string' && T.isValidZone(s.zone) ? s.zone
        : Array.isArray(s.zones) && s.zones.length && T.isValidZone(s.zones[0]) ? s.zones[0]
        : deviceZone;
      return {
        doy: typeof s.doy === 'string' ? s.doy : '',
        time: typeof s.time === 'string' ? s.time : '',
        zone,
      };
    }
  } catch { /* corrupted state falls through to defaults */ }
  return { doy: '', time: '', zone: deviceZone };
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

const $ = (id) => document.getElementById(id);
const doyInput = $('doy');
const timeInput = $('ztime');
const resolvedEl = $('resolved');
const zoneInput = $('zone-input');
const zoneOffsetEl = $('zone-offset');
const suggestEl = $('zone-suggest');
const timelineTable = $('timeline-table');
const timelineHead = $('timeline-head');
const timelineBody = $('timeline-body');
const copyBtn = $('copy-btn');
const shareBtn = $('share-btn');
const deviceBtn = $('zone-device-btn');

// ---- zone search index --------------------------------------------------
// Every zone is searchable by IANA id, city, long standard/daylight names,
// abbreviations, and UTC offset (e.g. "new york", "eastern standard", "edt").

const allZoneIds = typeof Intl.supportedValuesOf === 'function'
  ? Intl.supportedValuesOf('timeZone')
  : ['UTC'];
let zoneIndex = null;

// Well-known zones outrank obscure alphabetical neighbors on ties, so
// "eastern standard" surfaces New York before Cancun and Coral Harbour.
const MAJOR_ZONES = new Set([
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Europe/Rome', 'Europe/Istanbul', 'Asia/Dubai', 'Asia/Karachi',
  'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Hong_Kong',
  'Asia/Tokyo', 'Asia/Seoul', 'Asia/Singapore', 'Australia/Sydney',
  'Australia/Perth', 'Pacific/Auckland', 'Pacific/Guam', 'UTC',
]);

const tokenize = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function buildZoneEntry(id) {
  const year = new Date().getUTCFullYear();
  const names = new Set();
  for (const t of [Date.UTC(year, 0, 15), Date.UTC(year, 6, 15)]) {
    names.add(T.longZoneName(t, id));
    const abbr = T.zonedParts(t, id).zoneAbbr;
    if (!abbr.startsWith('GMT')) names.add(abbr);
  }
  const display = [...names].filter(Boolean);
  const offset = T.utcOffsetLabel(Date.now(), id);
  const textWords = tokenize(`${id} ${display.join(' ')} ${offset}`);
  return {
    id,
    display: display[0] || '',
    offset,
    words: [...new Set(textWords)],
    text: textWords.join(' '),
  };
}

// Building 418 entries costs ~2 Intl formatters each, so chunk it in the
// background; searches before it finishes fall back to id-only matching.
function buildZoneIndex() {
  const idx = [];
  let i = 0;
  const step = () => {
    const end = Math.min(i + 40, allZoneIds.length);
    for (; i < end; i++) {
      try { idx.push(buildZoneEntry(allZoneIds[i])); } catch { /* skip unformattable zone */ }
    }
    if (i < allZoneIds.length) setTimeout(step, 0);
    else zoneIndex = idx;
  };
  step();
}

function searchZones(query) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const phrase = tokens.join(' ');
  const source = zoneIndex
    ?? allZoneIds.map((id) => {
      const w = tokenize(id);
      return { id, display: '', offset: '', words: w, text: w.join(' ') };
    });
  const scored = [];
  for (const entry of source) {
    let score = 0;
    let ok = true;
    for (const tok of tokens) {
      let best = 3;
      for (const w of entry.words) {
        if (w === tok) { best = 0; break; }
        if (w.startsWith(tok)) best = Math.min(best, 1);
        else if (tok.startsWith(w)) best = Math.min(best, 2);
      }
      if (best === 3) { ok = false; break; }
      score += best;
    }
    if (!ok) continue;
    // Exact-phrase hits ("eastern standard" ⊂ "eastern standard time")
    // outrank scattered-word hits ("Eastern European Standard Time").
    if (entry.text.includes(phrase)) score -= 10;
    if (MAJOR_ZONES.has(entry.id)) score -= 1;
    scored.push([score, entry]);
  }
  scored.sort((a, b) => a[0] - b[0]
    || a[1].id.split('/').length - b[1].id.split('/').length
    || a[1].id.localeCompare(b[1].id));
  return scored.slice(0, 8).map((s) => s[1]);
}

function hideSuggest() {
  suggestEl.hidden = true;
  suggestEl.replaceChildren();
}

function showSuggest(query) {
  const results = searchZones(query);
  if (!results.length) { hideSuggest(); return; }
  suggestEl.replaceChildren();
  for (const r of results) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const idSpan = document.createElement('span');
    idSpan.className = 'zs-id';
    idSpan.textContent = r.id;
    const meta = document.createElement('span');
    meta.className = 'zs-meta';
    meta.textContent = [r.display, r.offset].filter(Boolean).join(' · ');
    btn.append(idSpan, meta);
    // preventDefault keeps the input focused so blur doesn't race the click
    btn.addEventListener('pointerdown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      setZone(r.id);
      hideSuggest();
      zoneInput.blur();
    });
    suggestEl.append(btn);
  }
  suggestEl.hidden = false;
}

// ---- rendering ----------------------------------------------------------

function th(text) {
  const el = document.createElement('th');
  el.textContent = text;
  return el;
}

function renderTimeline() {
  copyBtn.disabled = takeoffMs === null;
  shareBtn.disabled = takeoffMs === null;
  if (takeoffMs === null) {
    timelineTable.hidden = true;
    return;
  }
  timelineTable.hidden = false;

  const headRow = document.createElement('tr');
  headRow.append(th('Event'), th('Zulu'));
  const localCell = th(`Local (${T.zoneLabel(state.zone)})`);
  localCell.title = state.zone;
  headRow.append(localCell);
  timelineHead.replaceChildren(headRow);

  const toDoy = T.dayOfYearUtc(takeoffMs);
  const takeoffLocal = T.zonedParts(takeoffMs, state.zone);
  timelineBody.replaceChildren();
  for (const ev of EVENTS) {
    const ms = takeoffMs + ev.offsetMin * 60_000;
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.className = 'tl-name';
    nameTd.append(`${ev.name} `);
    const offSpan = document.createElement('span');
    offSpan.className = 'tl-off';
    offSpan.textContent = `(${ev.offsetMin === 0 ? '-0:00' : T.offsetToHMM(ev.offsetMin)})`;
    nameTd.append(offSpan);
    tr.append(nameTd);

    const zp = T.zonedParts(ms, 'UTC');
    const evDoy = T.dayOfYearUtc(ms);
    const zTd = document.createElement('td');
    zTd.className = 'time-cell';
    zTd.textContent = evDoy === toDoy
      ? `${zp.hhmm}Z`
      : `${String(evDoy).padStart(3, '0')}/${zp.hhmm}Z`;
    tr.append(zTd);

    const p = T.zonedParts(ms, state.zone);
    const localTd = document.createElement('td');
    localTd.className = 'time-cell';
    localTd.textContent = p.dateKey === takeoffLocal.dateKey
      ? p.hhmm
      : `${p.hhmm} (${p.weekday} ${Number(p.day)})`;
    tr.append(localTd);

    timelineBody.append(tr);
  }
}

function computeAll() {
  const doy = T.parseJulianDay(state.doy);
  const tm = T.parseTimeHHMM(state.time);
  doyInput.classList.toggle('invalid', state.doy.trim() !== '' && doy === null);
  timeInput.classList.toggle('invalid', state.time.trim() !== '' && tm === null);
  takeoffMs = null;
  if (doy !== null && tm !== null) {
    const year = T.resolveJulianYear(doy, Date.now());
    if (year === null) {
      resolvedEl.textContent = `Day ${doy} doesn't exist in the coming years.`;
      resolvedEl.className = 'resolved warn';
    } else {
      takeoffMs = T.makeUtcInstant(year, doy, tm.h, tm.m);
      const p = T.zonedParts(takeoffMs, 'UTC');
      const rolled = year !== new Date().getUTCFullYear();
      resolvedEl.textContent =
        `Takeoff ${p.hhmm}Z on ${p.weekday} ${p.day} ${p.month} ${p.year}${rolled ? ' (next year)' : ''}`;
      resolvedEl.className = rolled ? 'resolved warn' : 'resolved';
    }
  } else {
    resolvedEl.textContent = 'Enter Julian day and Zulu time…';
    resolvedEl.className = 'resolved empty';
  }
  zoneOffsetEl.textContent = takeoffMs !== null
    ? `${T.utcOffsetLabel(takeoffMs, state.zone)} at takeoff`
    : T.utcOffsetLabel(Date.now(), state.zone);
  renderTimeline();
}

function currentCopyText() {
  return T.buildCopyText(takeoffMs, EVENTS, [state.zone]);
}

function flash(btn, msg) {
  const original = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = original; }, 1600);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

function setZone(zone) {
  state.zone = zone;
  saveState();
  zoneInput.value = zone;
  zoneInput.classList.remove('invalid');
  deviceBtn.disabled = zone === deviceZone;
  computeAll();
}

function commitZone() {
  const z = zoneInput.value.trim();
  if (z && T.isValidZone(z)) {
    setZone(z);
  } else {
    zoneInput.classList.add('invalid');
    setTimeout(() => {
      zoneInput.value = state.zone;
      zoneInput.classList.remove('invalid');
    }, 900);
  }
}

function init() {
  $('version').textContent = VERSION;
  doyInput.value = state.doy;
  timeInput.value = state.time;
  zoneInput.value = state.zone;
  deviceBtn.disabled = state.zone === deviceZone;
  buildZoneIndex();

  doyInput.addEventListener('input', () => {
    state.doy = doyInput.value;
    saveState();
    computeAll();
  });
  timeInput.addEventListener('input', () => {
    state.time = timeInput.value;
    saveState();
    computeAll();
  });

  zoneInput.addEventListener('focus', () => zoneInput.select());
  zoneInput.addEventListener('input', () => {
    zoneInput.classList.remove('invalid');
    const q = zoneInput.value.trim();
    if (q) showSuggest(q); else hideSuggest();
  });
  zoneInput.addEventListener('blur', () => {
    setTimeout(() => {
      hideSuggest();
      if (zoneInput.value.trim() !== state.zone) commitZone();
    }, 150);
  });
  zoneInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = suggestEl.querySelector('button');
      if (first && !suggestEl.hidden) first.click();
      else commitZone();
      zoneInput.blur();
    } else if (e.key === 'Escape') {
      hideSuggest();
    }
  });
  deviceBtn.addEventListener('click', () => setZone(deviceZone));

  copyBtn.addEventListener('click', async () => {
    if (takeoffMs === null) return;
    const text = currentCopyText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      fallbackCopy(text);
    }
    flash(copyBtn, 'Copied ✓');
  });

  if (navigator.share) {
    shareBtn.addEventListener('click', () => {
      if (takeoffMs === null) return;
      navigator.share({ text: currentCopyText() }).catch(() => { /* user cancelled */ });
    });
  } else {
    shareBtn.hidden = true;
  }

  computeAll();
}

init();
