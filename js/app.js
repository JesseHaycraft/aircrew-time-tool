import * as T from './time-engine.js';

const VERSION = 'v0.1.3';
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
const timelineTable = $('timeline-table');
const timelineHead = $('timeline-head');
const timelineBody = $('timeline-body');
const copyBtn = $('copy-btn');
const shareBtn = $('share-btn');
const deviceBtn = $('zone-device-btn');

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
  headRow.append(th('Event'), th('Z'));
  const localCell = th('Local');
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

  const list = $('zone-list');
  const zones = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : [];
  for (const z of zones) {
    const opt = document.createElement('option');
    opt.value = z;
    list.append(opt);
  }

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
  zoneInput.addEventListener('change', commitZone);
  zoneInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitZone();
      zoneInput.blur();
    }
  });
  deviceBtn.addEventListener('click', () => setZone(deviceZone));
  deviceBtn.disabled = state.zone === deviceZone;

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
