// The ?v= query on this import and on the <script>/<link> tags in
// index.html must move together each release — it pins the browser
// cache so a new HTML page can never run against stale JS.
import * as T from './time-engine.js?v=0.2.1';

const VERSION = 'v0.2.1';
const STORAGE_KEY = 'att-state-v1';
const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const DEFAULT_TEMPLATE_EVENTS = [
  { name: 'Stop drink', offset: '-12:00' },
  { name: 'LFA', offset: '-4:15' },
  { name: 'Bus', offset: '-3:15' },
];

const newId = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function makeDefaultTemplate() {
  return { id: newId(), name: 'Standard', events: DEFAULT_TEMPLATE_EVENTS.map((e) => ({ ...e })) };
}

const todayUtcStr = () => new Date().toISOString().slice(0, 10);

let state = loadState();
let takeoffMs = null;

function sanitizeTemplates(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw) {
    if (!t || typeof t.name !== 'string' || !Array.isArray(t.events)) continue;
    out.push({
      id: typeof t.id === 'string' ? t.id : newId(),
      name: t.name,
      events: t.events
        .filter((e) => e && typeof e.name === 'string' && typeof e.offset === 'string')
        .map((e) => ({ name: e.name, offset: e.offset })),
    });
  }
  return out;
}

function loadState() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; } catch { /* corrupted */ }
  // Older versions stored a zones array; keep the first entry.
  const zone =
    typeof s.zone === 'string' && T.isValidZone(s.zone) ? s.zone
    : Array.isArray(s.zones) && s.zones.length && T.isValidZone(s.zones[0]) ? s.zones[0]
    : deviceZone;
  const templates = sanitizeTemplates(s.templates);
  if (!templates.length) templates.push(makeDefaultTemplate());
  const activeTemplateId = templates.some((t) => t.id === s.activeTemplateId)
    ? s.activeTemplateId
    : templates[0].id;
  return {
    doy: typeof s.doy === 'string' ? s.doy : '',
    time: typeof s.time === 'string' ? s.time : '',
    dateMode: s.dateMode === 'calendar' ? 'calendar' : 'julian',
    calDate: typeof s.calDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.calDate)
      ? s.calDate
      : todayUtcStr(),
    zone,
    templates,
    activeTemplateId,
  };
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

function activeTemplate() {
  return state.templates.find((t) => t.id === state.activeTemplateId) ?? state.templates[0];
}

// Active template's valid events plus the always-included takeoff, sorted.
function timelineEvents() {
  const events = activeTemplate().events
    .map((e) => ({ name: e.name.trim() || 'Event', offsetMin: T.parseOffset(e.offset) }))
    .filter((e) => e.offsetMin !== null);
  events.push({ name: 'Takeoff', offsetMin: 0 });
  return events.sort((a, b) => a.offsetMin - b.offsetMin);
}

const $ = (id) => document.getElementById(id);
const doyInput = $('doy');
const calInput = $('caldate');
const modeJulianBtn = $('mode-julian');
const modeCalBtn = $('mode-cal');
const timeInput = $('ztime');
const resolvedEl = $('resolved');
const zoneInput = $('zone-input');
const suggestEl = $('zone-suggest');
const timelineTable = $('timeline-table');
const timelineHead = $('timeline-head');
const timelineBody = $('timeline-body');
const copyBtn = $('copy-btn');
const shareBtn = $('share-btn');
const deviceBtn = $('zone-device-btn');
const tplSelect = $('tpl-select');
const tplOverlay = $('tpl-overlay');
const tplName = $('tpl-name');
const tplEvents = $('tpl-events');

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

function renderTemplateSelect() {
  tplSelect.replaceChildren();
  for (const t of state.templates) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name || 'Untitled';
    opt.selected = t.id === state.activeTemplateId;
    tplSelect.append(opt);
  }
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
  for (const ev of timelineEvents()) {
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
  const tm = T.parseTimeHHMM(state.time);
  timeInput.classList.toggle('invalid', state.time.trim() !== '' && tm === null);
  takeoffMs = null;
  let resolvedText = null;
  let resolvedClass = 'resolved';

  if (state.dateMode === 'calendar') {
    doyInput.classList.remove('invalid');
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(state.calDate);
    if (m && tm !== null) {
      takeoffMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), tm.h, tm.m);
      const p = T.zonedParts(takeoffMs, 'UTC');
      resolvedText =
        `Takeoff ${p.hhmm}Z on ${p.weekday} ${p.day} ${p.month} ${p.year} (Day ${T.dayOfYearUtc(takeoffMs)})`;
    }
  } else {
    const doy = T.parseJulianDay(state.doy);
    doyInput.classList.toggle('invalid', state.doy.trim() !== '' && doy === null);
    if (doy !== null && tm !== null) {
      const year = T.resolveJulianYear(doy, Date.now());
      if (year === null) {
        resolvedText = `Day ${doy} doesn't exist in the coming years.`;
        resolvedClass = 'resolved warn';
      } else {
        takeoffMs = T.makeUtcInstant(year, doy, tm.h, tm.m);
        const p = T.zonedParts(takeoffMs, 'UTC');
        const rolled = year !== new Date().getUTCFullYear();
        resolvedText =
          `Takeoff ${p.hhmm}Z on ${p.weekday} ${p.day} ${p.month} ${p.year}${rolled ? ' (next year)' : ''}`;
        resolvedClass = rolled ? 'resolved warn' : 'resolved';
      }
    }
  }

  if (resolvedText === null) {
    resolvedText = state.dateMode === 'calendar'
      ? 'Pick a date and enter Zulu time…'
      : 'Enter Julian day and Zulu time…';
    resolvedClass = 'resolved empty';
  }
  resolvedEl.textContent = resolvedText;
  resolvedEl.className = resolvedClass;
  if (document.activeElement !== zoneInput) {
    zoneInput.value = zoneDisplayValue();
    zoneInput.scrollLeft = 0;
  }
  renderTimeline();
}

// The input shows the zone with its UTC offset, e.g. "Pacific/Guam UTC+10",
// computed at the takeoff instant when one is set so it's DST-correct.
function zoneDisplayValue() {
  return `${state.zone} ${T.utcOffsetLabel(takeoffMs ?? Date.now(), state.zone)}`;
}

function currentCopyText() {
  return T.buildCopyText(takeoffMs, timelineEvents(), [state.zone]);
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
  zoneInput.classList.remove('invalid');
  deviceBtn.disabled = zone === deviceZone;
  computeAll();
  zoneInput.value = zoneDisplayValue();
  zoneInput.scrollLeft = 0;
}

function updateModeUI() {
  const cal = state.dateMode === 'calendar';
  doyInput.hidden = cal;
  calInput.hidden = !cal;
  modeJulianBtn.classList.toggle('active', !cal);
  modeCalBtn.classList.toggle('active', cal);
}

function setDateMode(mode) {
  state.dateMode = mode;
  saveState();
  updateModeUI();
  computeAll();
  if (mode === 'calendar' && typeof calInput.showPicker === 'function') {
    try { calInput.showPicker(); } catch { /* not allowed outside a gesture */ }
  }
}

function commitZone() {
  const z = zoneInput.value.trim();
  if (z && T.isValidZone(z)) {
    setZone(z);
  } else {
    zoneInput.classList.add('invalid');
    setTimeout(() => {
      zoneInput.value = zoneDisplayValue();
      zoneInput.classList.remove('invalid');
    }, 900);
  }
}

// ---- template editor ----------------------------------------------------

function markOffsetValidity(input, value) {
  input.classList.toggle('invalid', T.parseOffset(value) === null && value.trim() !== '');
}

function uniqueTemplateName(base) {
  const names = new Set(state.templates.map((t) => t.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

function renderTemplateEditor() {
  const tpl = activeTemplate();
  tplName.value = tpl.name;
  tplEvents.replaceChildren();
  tpl.events.forEach((ev, i) => {
    const row = document.createElement('div');
    row.className = 'ev-row';

    const nameIn = document.createElement('input');
    nameIn.className = 'ev-name';
    nameIn.value = ev.name;
    nameIn.placeholder = 'Event';
    nameIn.addEventListener('input', () => {
      ev.name = nameIn.value;
      saveState();
      computeAll();
    });

    const offIn = document.createElement('input');
    offIn.className = 'ev-offset';
    offIn.value = ev.offset;
    offIn.placeholder = '-0:30';
    offIn.autocomplete = 'off';
    markOffsetValidity(offIn, ev.offset);
    offIn.addEventListener('input', () => {
      ev.offset = offIn.value;
      saveState();
      markOffsetValidity(offIn, ev.offset);
      computeAll();
    });

    const del = document.createElement('button');
    del.className = 'row-x';
    del.type = 'button';
    del.textContent = '×';
    del.title = 'Remove event';
    del.addEventListener('click', () => {
      tpl.events.splice(i, 1);
      saveState();
      renderTemplateEditor();
      computeAll();
    });

    row.append(nameIn, offIn, del);
    tplEvents.append(row);
  });
}

function selectTemplate(id) {
  state.activeTemplateId = id;
  saveState();
  renderTemplateSelect();
  computeAll();
}

function openEditor() {
  renderTemplateEditor();
  tplOverlay.hidden = false;
  document.body.classList.add('no-scroll');
}

function closeEditor() {
  tplOverlay.hidden = true;
  document.body.classList.remove('no-scroll');
  renderTemplateSelect();
  computeAll();
}

function init() {
  $('version').textContent = VERSION;
  doyInput.value = state.doy;
  calInput.value = state.calDate;
  timeInput.value = state.time;
  deviceBtn.disabled = state.zone === deviceZone;
  buildZoneIndex();
  renderTemplateSelect();
  updateModeUI();

  doyInput.addEventListener('input', () => {
    state.doy = doyInput.value;
    saveState();
    computeAll();
  });
  calInput.addEventListener('input', () => {
    state.calDate = calInput.value;
    saveState();
    computeAll();
  });
  modeJulianBtn.addEventListener('click', () => setDateMode('julian'));
  modeCalBtn.addEventListener('click', () => setDateMode('calendar'));
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
      if (zoneInput.value.trim() !== zoneDisplayValue()) commitZone();
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

  tplSelect.addEventListener('change', () => selectTemplate(tplSelect.value));
  $('tpl-edit-btn').addEventListener('click', openEditor);
  $('tpl-done').addEventListener('click', closeEditor);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !tplOverlay.hidden) closeEditor();
  });

  tplName.addEventListener('input', () => {
    activeTemplate().name = tplName.value;
    saveState();
    renderTemplateSelect();
  });
  $('tpl-add-event').addEventListener('click', () => {
    activeTemplate().events.push({ name: '', offset: '-1:00' });
    saveState();
    renderTemplateEditor();
    computeAll();
  });
  $('tpl-new').addEventListener('click', () => {
    const tpl = { id: newId(), name: uniqueTemplateName('New template'), events: [] };
    state.templates.push(tpl);
    selectTemplate(tpl.id);
    renderTemplateEditor();
  });
  $('tpl-duplicate').addEventListener('click', () => {
    const src = activeTemplate();
    const tpl = {
      id: newId(),
      name: uniqueTemplateName(`${src.name} (copy)`),
      events: src.events.map((e) => ({ ...e })),
    };
    state.templates.push(tpl);
    selectTemplate(tpl.id);
    renderTemplateEditor();
  });
  $('tpl-restore').addEventListener('click', () => {
    const tpl = makeDefaultTemplate();
    tpl.name = uniqueTemplateName(tpl.name);
    state.templates.push(tpl);
    selectTemplate(tpl.id);
    renderTemplateEditor();
  });
  $('tpl-delete').addEventListener('click', () => {
    const tpl = activeTemplate();
    if (!window.confirm(`Delete template "${tpl.name}"?`)) return;
    state.templates = state.templates.filter((t) => t.id !== tpl.id);
    if (!state.templates.length) state.templates.push(makeDefaultTemplate());
    selectTemplate(state.templates[0].id);
    renderTemplateEditor();
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

  computeAll();
}

init();
