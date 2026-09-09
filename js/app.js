import * as T from './time-engine.js';

const VERSION = 'v0.1.0';
const STORAGE_KEY = 'att-state-v1';
const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const DEFAULT_STATE = () => ({
  doy: '',
  time: '',
  zones: deviceZone === 'UTC' ? [] : [deviceZone],
  events: [
    { name: 'Brief', offset: '-2:30' },
    { name: 'Show', offset: '-2:00' },
    { name: 'Step to jet', offset: '-1:00' },
    { name: 'Engine start', offset: '-0:40' },
    { name: 'Takeoff', offset: '0:00' },
  ],
});

let state = loadState();
let takeoffMs = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (Array.isArray(s.zones) && Array.isArray(s.events)) return s;
    }
  } catch { /* corrupted state falls through to defaults */ }
  return DEFAULT_STATE();
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

const $ = (id) => document.getElementById(id);
const doyInput = $('doy');
const timeInput = $('ztime');
const resolvedEl = $('resolved');
const zoneChipsEl = $('zone-chips');
const zoneAddInput = $('zone-add');
const eventsHead = $('events-head');
const eventsBody = $('events-body');
const copyBtn = $('copy-btn');
const shareBtn = $('share-btn');

function zoneLabel(zone) {
  return zone.split('/').pop().replaceAll('_', ' ');
}

function th(text) {
  const el = document.createElement('th');
  el.textContent = text;
  return el;
}

function renderZoneChips() {
  zoneChipsEl.replaceChildren();
  for (const z of state.zones) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.title = z;
    chip.append(zoneLabel(z));
    const x = document.createElement('button');
    x.className = 'chip-x';
    x.type = 'button';
    x.textContent = '×';
    x.title = `Remove ${z}`;
    x.addEventListener('click', () => {
      state.zones = state.zones.filter((v) => v !== z);
      saveState();
      renderAll();
    });
    chip.append(x);
    zoneChipsEl.append(chip);
  }
}

function renderEventsTable() {
  const headRow = document.createElement('tr');
  headRow.append(th('Event'), th('Offset'), th('Z'));
  for (const z of state.zones) {
    const cell = th(zoneLabel(z));
    cell.title = z;
    headRow.append(cell);
  }
  headRow.append(th(''));
  eventsHead.replaceChildren(headRow);

  eventsBody.replaceChildren();
  state.events.forEach((ev, i) => {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    const nameIn = document.createElement('input');
    nameIn.className = 'ev-name';
    nameIn.value = ev.name;
    nameIn.addEventListener('input', () => {
      ev.name = nameIn.value;
      saveState();
    });
    nameTd.append(nameIn);

    const offTd = document.createElement('td');
    const offIn = document.createElement('input');
    offIn.className = 'ev-offset';
    offIn.value = ev.offset;
    offIn.placeholder = '-0:30';
    offIn.autocomplete = 'off';
    offIn.addEventListener('input', () => {
      ev.offset = offIn.value;
      saveState();
      computeRow(tr, ev);
    });
    offTd.append(offIn);

    tr.append(nameTd, offTd);

    const zTd = document.createElement('td');
    zTd.className = 'time-cell';
    tr.append(zTd);
    for (const z of state.zones) {
      const td = document.createElement('td');
      td.className = 'time-cell';
      tr.append(td);
    }

    const delTd = document.createElement('td');
    const del = document.createElement('button');
    del.className = 'row-x';
    del.type = 'button';
    del.textContent = '×';
    del.title = 'Remove event';
    del.addEventListener('click', () => {
      state.events.splice(i, 1);
      saveState();
      renderAll();
    });
    delTd.append(del);
    tr.append(delTd);

    eventsBody.append(tr);
  });
}

function computeRow(tr, ev) {
  const offIn = tr.querySelector('.ev-offset');
  const cells = tr.querySelectorAll('.time-cell');
  const off = T.parseOffset(ev.offset);
  offIn.classList.toggle('invalid', off === null && ev.offset.trim() !== '');
  if (takeoffMs === null || off === null) {
    cells.forEach((c) => { c.textContent = '—'; });
    return;
  }
  const ms = takeoffMs + off * 60_000;
  const evZ = T.zonedParts(ms, 'UTC');
  const evDoy = T.dayOfYearUtc(ms);
  const toDoy = T.dayOfYearUtc(takeoffMs);
  cells[0].textContent = evDoy === toDoy
    ? `${evZ.hhmm}Z`
    : `${String(evDoy).padStart(3, '0')}/${evZ.hhmm}Z`;
  state.zones.forEach((z, idx) => {
    const p = T.zonedParts(ms, z);
    const tp = T.zonedParts(takeoffMs, z);
    const flag = p.dateKey === tp.dateKey ? '' : ` (${p.weekday} ${Number(p.day)})`;
    cells[idx + 1].textContent = `${p.hhmm}${flag}`;
  });
}

function computeAll() {
  const doy = T.parseJulianDay(state.doy);
  const tm = T.parseTimeHHMM(state.time);
  doyInput.classList.toggle('invalid', state.doy.trim() !== '' && doy === null);
  timeInput.classList.toggle('invalid', state.time.trim() !== '' && tm === null);
  takeoffMs = null;
  resolvedEl.classList.remove('warn');
  if (doy !== null && tm !== null) {
    const year = T.resolveJulianYear(doy, Date.now());
    if (year === null) {
      resolvedEl.textContent = `Day ${doy} doesn't exist in the coming years.`;
      resolvedEl.classList.add('warn');
    } else {
      takeoffMs = T.makeUtcInstant(year, doy, tm.h, tm.m);
      const p = T.zonedParts(takeoffMs, 'UTC');
      const rolled = year !== new Date().getUTCFullYear();
      resolvedEl.textContent =
        `${p.weekday} ${p.day} ${p.month} ${p.year} — takeoff ${p.hhmm}Z${rolled ? ' (next year)' : ''}`;
      resolvedEl.classList.toggle('warn', rolled);
    }
  } else {
    resolvedEl.textContent = 'Enter Julian day and Zulu time…';
  }
  [...eventsBody.children].forEach((tr, i) => computeRow(tr, state.events[i]));
  copyBtn.disabled = takeoffMs === null;
  shareBtn.disabled = takeoffMs === null;
}

function renderAll() {
  renderZoneChips();
  renderEventsTable();
  computeAll();
}

function currentCopyText() {
  const events = state.events
    .map((e) => ({ name: e.name.trim() || 'EVENT', offsetMin: T.parseOffset(e.offset) }))
    .filter((e) => e.offsetMin !== null);
  return T.buildCopyText(takeoffMs, events, state.zones);
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

function addZone() {
  const z = zoneAddInput.value.trim();
  if (!z || !T.isValidZone(z)) {
    zoneAddInput.classList.add('invalid');
    return;
  }
  if (!state.zones.includes(z)) {
    state.zones.push(z);
    saveState();
    renderAll();
  }
  zoneAddInput.value = '';
  zoneAddInput.classList.remove('invalid');
}

function init() {
  $('version').textContent = VERSION;
  doyInput.value = state.doy;
  timeInput.value = state.time;

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

  $('zone-add-btn').addEventListener('click', addZone);
  zoneAddInput.addEventListener('change', () => {
    if (T.isValidZone(zoneAddInput.value.trim())) addZone();
  });
  zoneAddInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addZone();
    }
  });
  zoneAddInput.addEventListener('input', () => zoneAddInput.classList.remove('invalid'));

  $('add-event').addEventListener('click', () => {
    state.events.push({ name: 'New event', offset: '-1:00' });
    saveState();
    renderAll();
  });
  $('reset-events').addEventListener('click', () => {
    state.events = DEFAULT_STATE().events;
    saveState();
    renderAll();
  });

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

  renderAll();
}

init();
