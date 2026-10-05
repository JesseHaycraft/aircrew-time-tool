// The ?v= query on this import and on the <script>/<link> tags in
// index.html must move together each release — it pins the browser
// cache so a new HTML page can never run against stale JS.
import * as T from './time-engine.js?v=0.6.1';
import { initSlider } from './slider.js?v=0.6.1';

const VERSION = 'v0.6.1';
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
  return {
    id: newId(),
    name: 'Standard',
    takeoffCountdown: false,
    includeLanding: true,
    landingCountdown: false,
    events: DEFAULT_TEMPLATE_EVENTS.map((e) => ({ ...e })),
  };
}

// Zone data kept on the device: the last good copy of data/tzdata.json and
// when the site last answered an update check (see "zone data" below).
const ZONE_DATA_KEY = 'att-zonedata-v1';
const ZONE_CHECK_KEY = 'att-zonedata-checked';
const DAY_MS = 86_400_000;
const ZONE_STALE_DAYS = 30;                  // warn after this long without a check
const ZONE_RECHECK_AFTER = 12 * 3_600_000;   // an open page checks again after this
const FAR_TAKEOFF_DAYS = 30;                 // a takeoff further off than this is flagged
let zoneCheckedMs = null;
try {
  const saved = Number(localStorage.getItem(ZONE_CHECK_KEY));
  if (Number.isFinite(saved) && saved > 0) zoneCheckedMs = saved;
} catch { /* storage unavailable */ }

const todayUtcStr = () => new Date().toISOString().slice(0, 10);

// The pages, in page-bar order.
const PAGES = ['frag', 'soes', 'convert', 'about'];
// Page names saved or bookmarked by versions before the three-page layout.
const OLD_PAGES = { julian: 'frag', slider: 'convert' };
const pageFromName = (name) => (PAGES.includes(name) ? name : OLD_PAGES[name] ?? null);

let state = loadState();
let takeoffMs = null;
let landingMs = null;   // from the Landing card, only when a takeoff is set too

function sanitizeTemplates(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw) {
    if (!t || typeof t.name !== 'string' || !Array.isArray(t.events)) continue;
    out.push({
      id: typeof t.id === 'string' ? t.id : newId(),
      name: t.name,
      takeoffCountdown: t.takeoffCountdown === true,
      includeLanding: t.includeLanding !== false,
      landingCountdown: t.landingCountdown === true,
      events: t.events
        .filter((e) => e && typeof e.name === 'string' && typeof e.offset === 'string')
        .map((e) => ({ name: e.name, offset: e.offset, countdown: e.countdown === true })),
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
  // Seed the starter template only on true first run — an intentionally
  // emptied list stays empty (templatesInitialized marks the difference).
  if (!templates.length && s.templatesInitialized !== true) {
    templates.push(makeDefaultTemplate());
  }
  const activeTemplateId = templates.some((t) => t.id === s.activeTemplateId)
    ? s.activeTemplateId
    : (templates[0]?.id ?? null);
  const sliderZones = Array.isArray(s.sliderZones)
    ? [...new Set(s.sliderZones.filter((z) => typeof z === 'string' && T.isValidZone(z)))]
    : [];
  // The slider used to pin the Frag-page zone; now only Zulu is fixed.
  // Seed that zone as an ordinary (deletable) row once, so nobody loses it.
  if (s.sliderZonesInitialized !== true && zone !== 'UTC' && !sliderZones.includes(zone)) {
    sliderZones.unshift(zone);
  }
  return {
    doy: typeof s.doy === 'string' ? s.doy : '',
    time: typeof s.time === 'string' ? s.time : '',
    page: pageFromName(s.page) ?? 'frag',
    sliderZones,
    sliderZonesInitialized: true,
    dateMode: s.dateMode === 'calendar' ? 'calendar' : 'julian',
    // a Julian day is a Zulu day, so local time goes only with a calendar date
    timeMode: s.timeMode === 'local' && s.dateMode === 'calendar' ? 'local' : 'zulu',
    showZulu: s.showZulu !== undefined ? s.showZulu !== false : s.copyZulu !== false,
    landingMode: ['local', 'duration'].includes(s.landingMode) ? s.landingMode : 'zulu',
    landingZulu: typeof s.landingZulu === 'string' ? s.landingZulu : '',
    landingLocal: typeof s.landingLocal === 'string' ? s.landingLocal : '',
    landingDuration: typeof s.landingDuration === 'string' ? s.landingDuration : '',
    calDate: typeof s.calDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.calDate)
      ? s.calDate
      : todayUtcStr(),
    zone,
    templates,
    templatesInitialized: true,
    activeTemplateId,
  };
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

function activeTemplate() {
  return state.templates.find((t) => t.id === state.activeTemplateId)
    ?? state.templates[0]
    ?? null;
}

// Active template's valid events plus the always-included takeoff, sorted.
function timelineEvents() {
  const tpl = activeTemplate();
  const events = (tpl ? tpl.events : [])
    .map((e) => ({
      name: e.name.trim() || 'Event',
      offsetMin: T.parseOffset(e.offset),
      countdown: e.countdown === true,
    }))
    .filter((e) => e.offsetMin !== null);
  events.push({ name: 'Takeoff', offsetMin: 0, countdown: tpl?.takeoffCountdown === true });
  if (landingMs !== null && takeoffMs !== null && tpl?.includeLanding !== false) {
    events.push({
      name: 'Landing',
      offsetMin: Math.round((landingMs - takeoffMs) / 60_000),
      countdown: tpl?.landingCountdown === true,
    });
  }
  return events.sort((a, b) => a.offsetMin - b.offsetMin);
}

const $ = (id) => document.getElementById(id);
const doyInput = $('doy');
const calInput = $('caldate');
const modeJulianBtn = $('mode-julian');
const modeCalBtn = $('mode-cal');
const modeZuluBtn = $('mode-zulu');
const modeLocalBtn = $('mode-local');
const modeLZuluBtn = $('mode-lzulu');
const modeLLocalBtn = $('mode-llocal');
const modeLDurBtn = $('mode-ldur');
const landingInput = $('landing-input');
const landingInputLabel = $('landing-input-label');
const landingCalc = $('landing-calc');
const landingCalcLabel = $('landing-calc-label');
const timeInput = $('ztime');
const dateLabel = $('date-label');
const timeLabel = $('time-label');
const resolvedEl = $('resolved');
const soeEmpty = $('soe-empty');
const zoneNote = $('zone-note');
const zoneStamp = $('zone-stamp');
const zoneDetail = $('zone-detail');
const zoneCheckBtn = $('zone-check-btn');
const zoneCheckResult = $('zone-check-result');
const clockEl = $('clock');
const zoneInput = $('zone-input');
const suggestEl = $('zone-suggest');
const timelineTable = $('timeline-table');
const timelineHead = $('timeline-head');
const timelineBody = $('timeline-body');
const copyBtn = $('copy-btn');
const copyZuluSwitch = $('copy-zulu');
const copyZuluState = $('copy-zulu-state');
const deviceBtn = $('zone-device-btn');
const tplSelectBtn = $('tpl-select-btn');
const tplSelectLabel = $('tpl-select-label');
const tplSelectMenu = $('tpl-select-menu');
const tplOverlay = $('tpl-overlay');
const tplListView = $('tpl-list-view');
const tplEditorView = $('tpl-editor-view');
const tplList = $('tpl-list');
const tplName = $('tpl-name');
const tplEvents = $('tpl-events');
const tplTakeoffCdSlot = $('tpl-takeoff-cd');
const tplLandingCdSlot = $('tpl-landing-cd');
const tplLandingInclude = $('tpl-landing-include');

// The editor works on a draft copy; Save commits it, ‹ Templates discards.
let draft = null;
let draftIsNew = false;
// Template row currently showing its inline delete confirmation.
let confirmDeleteId = null;

// ---- zone search index --------------------------------------------------
// Every zone is searchable by IANA id, city, long standard/daylight names,
// abbreviations, and UTC offset (e.g. "new york", "eastern standard", "edt").

const allZoneIds = typeof Intl.supportedValuesOf === 'function'
  ? Intl.supportedValuesOf('timeZone')
  : ['UTC'];
let zoneIndex = null;
let zoneIndexById = null;

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
    names.add(T.zoneAbbr(t, id));   // '' when the zone has none; dropped below
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
    else {
      zoneIndex = idx;
      zoneIndexById = new Map(idx.map((e) => [e.id, e]));
    }
  };
  step();
}

// Browse list for an untyped click: major zones first, then the full
// catalog alphabetically.
function browseEntries() {
  const majors = [];
  const rest = [];
  for (const id of allZoneIds) (MAJOR_ZONES.has(id) ? majors : rest).push(id);
  return [...majors, ...rest].map((id) =>
    zoneIndexById?.get(id) ?? { id, display: '', offset: '' });
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

// Shared searchable zone dropdown: browse list on plain focus, typed
// queries narrow it. Used by the Julian zone field and the slider's
// zone editor.
function createZonePicker({ input, menu, isActive, onPick, onEnterFallback }) {
  const hide = () => {
    menu.hidden = true;
    menu.replaceChildren();
  };
  const show = (query) => {
    const results = query ? searchZones(query) : browseEntries();
    if (!results.length) { hide(); return; }
    menu.replaceChildren();
    for (const r of results) {
      const btn = document.createElement('button');
      btn.type = 'button';
      if (isActive?.(r.id)) btn.className = 'active';
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
        onPick(r.id);
        hide();
        input.blur();
      });
      menu.append(btn);
    }
    menu.hidden = false;
  };
  input.addEventListener('focus', () => {
    input.select();
    show('');
  });
  input.addEventListener('input', () => {
    input.classList.remove('invalid');
    show(input.value.trim());
  });
  input.addEventListener('blur', () => setTimeout(hide, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = menu.querySelector('button');
      if (first && !menu.hidden) first.click();
      else onEnterFallback?.();
      input.blur();
    } else if (e.key === 'Escape') {
      hide();
    }
  });
  return { hide };
}

// ---- rendering ----------------------------------------------------------

function th(text) {
  const el = document.createElement('th');
  el.textContent = text;
  return el;
}

function renderTemplateSelect() {
  const tpl = activeTemplate();
  tplSelectLabel.textContent = state.templates.length
    ? (tpl?.name || 'Untitled')
    : 'No templates';
  tplSelectBtn.disabled = !state.templates.length;
  hideTplMenu();
}

function hideTplMenu() {
  tplSelectMenu.hidden = true;
  tplSelectMenu.replaceChildren();
  tplSelectBtn.setAttribute('aria-expanded', 'false');
}

function showTplMenu() {
  tplSelectMenu.replaceChildren();
  for (const t of state.templates) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = t.id === state.activeTemplateId ? 'active' : '';
    b.textContent = t.name || 'Untitled';
    b.addEventListener('click', () => {
      selectTemplate(t.id);
      hideTplMenu();
    });
    tplSelectMenu.append(b);
  }
  tplSelectMenu.hidden = false;
  tplSelectBtn.setAttribute('aria-expanded', 'true');
}

// Says so whenever the times on screen come from the device's own zone
// rules instead of the app's: the data file didn't load, or the zone or
// one of the instants isn't in it.
function renderZoneNote(instants) {
  let text = '';
  const staleDays = zoneDataStaleDays();
  if (T.zoneDataInfo() === null) {
    text = 'Time zone data hasn’t loaded — using this device’s own rules, which may be out of date.';
  } else if (instants.some((ms) => T.usesDeviceData(ms, state.zone) || T.usesDeviceData(ms, 'UTC'))) {
    text = 'Not covered by the app’s time zone data — using this device’s own rules for these times.';
  } else if (staleDays !== null) {
    text = `Time zone data hasn’t been checked for updates in ${staleDays} days — `
      + 'go online and check from the About page.';
  }
  zoneNote.hidden = text === '';
  zoneNote.textContent = text;
}

// Whole days since the site last answered an update check; null if never.
function zoneDataCheckedDays() {
  return zoneCheckedMs === null ? null : Math.max(0, Math.floor((Date.now() - zoneCheckedMs) / DAY_MS));
}

// That count once it has gone past the limit, else null.
function zoneDataStaleDays() {
  const days = zoneDataCheckedDays();
  return days !== null && days >= ZONE_STALE_DAYS ? days : null;
}

// About-page stamp: which release of the time zone rules the app is
// running on and when it last checked for a newer one, the way a chart
// carries its edition and currency.
function renderZoneStamp() {
  const info = T.zoneDataInfo();
  if (!info) {
    zoneStamp.textContent = 'Not loaded';
    zoneStamp.classList.add('warn');
    zoneDetail.textContent = 'Using this device’s own time zone rules, which may be out of date.';
    return;
  }
  const days = zoneDataCheckedDays();
  const stale = zoneDataStaleDays() !== null;
  const checked = days === null ? ''
    : stale ? `, not checked for ${days} days`
    : days === 0 ? ', checked today'
    : days === 1 ? ', checked yesterday'
    : `, checked ${days} days ago`;
  zoneStamp.textContent = `IANA release ${info.version}${checked}`;
  zoneStamp.classList.toggle('warn', stale);
  zoneDetail.textContent = `Built ${info.built}. `
    + `Covers ${new Date(info.fromMs).getUTCFullYear()}–${new Date(info.untilMs - 1).getUTCFullYear()}. `
    + 'The app checks for a newer release whenever it is opened online.';
}

function renderTimeline() {
  copyBtn.disabled = takeoffMs === null;
  soeEmpty.hidden = takeoffMs !== null;
  if (takeoffMs === null) {
    timelineTable.hidden = true;
    renderZoneNote([]);
    tickClock();
    return;
  }
  timelineTable.hidden = false;

  const showZ = state.showZulu;
  const headRow = document.createElement('tr');
  headRow.append(th('Event'));
  if (showZ) headRow.append(th('Zulu'));
  const localCell = th(`Local (${T.zoneLabel(state.zone)})`);
  localCell.title = state.zone;
  headRow.append(localCell);
  timelineHead.replaceChildren(headRow);

  // All-or-nothing day flags: if more than one calendar day appears in
  // the sequence (either column), every time states its day; when
  // everything shares one day, no flags at all.
  const rows = timelineEvents().map((ev) => {
    const ms = takeoffMs + ev.offsetMin * 60_000;
    return { ev, ms, zp: T.zonedParts(ms, 'UTC'), lp: T.zonedParts(ms, state.zone) };
  });
  renderZoneNote(rows.map((r) => r.ms));
  const dateKeys = new Set();
  for (const r of rows) {
    if (showZ) dateKeys.add(r.zp.dateKey);
    dateKeys.add(r.lp.dateKey);
  }
  const showFlags = dateKeys.size > 1;
  const dayFlag = (parts) => {
    const span = document.createElement('span');
    span.className = 'day-flag';
    span.textContent = `(${parts.weekday} ${Number(parts.day)})`;
    return span;
  };

  timelineBody.replaceChildren();
  for (const { ev, zp, lp } of rows) {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.className = 'tl-name';
    nameTd.append(`${ev.name} `);
    const offSpan = document.createElement('span');
    offSpan.className = 'tl-off';
    offSpan.textContent = `(${ev.offsetMin === 0 ? '-0:00' : T.offsetToHMM(ev.offsetMin)})`;
    nameTd.append(offSpan);
    tr.append(nameTd);

    const zTd = document.createElement('td');
    zTd.className = 'time-cell';
    zTd.append(`${zp.hhmm}Z`);
    if (showFlags) zTd.append(' ', dayFlag(zp));
    if (showZ) tr.append(zTd);

    const localTd = document.createElement('td');
    localTd.className = 'time-cell';
    localTd.append(`${lp.hhmm}L`);
    if (showFlags) localTd.append(' ', dayFlag(lp));
    if (ev.countdown) {
      const cd = document.createElement('span');
      cd.className = 'countdown';
      cd.dataset.target = String(takeoffMs + ev.offsetMin * 60_000);
      localTd.append(cd);
    }
    tr.append(localTd);

    timelineBody.append(tr);
  }
  tickClock();
}

// The current-time line and the countdowns refresh on the wall-clock
// minute (plus a small margin so the rounding in formatCountdown lands on
// the new minute), and immediately when the tab comes back to the
// foreground — background timers throttle.
let clockTimer = null;
function tickClock() {
  clearTimeout(clockTimer);
  const now = Date.now();
  const label = document.createElement('span');
  label.className = 'clock-label';
  label.textContent = 'Current time: ';
  const zp = T.zonedParts(now, 'UTC');
  const lp = T.zonedParts(now, state.zone);
  const part = (text) => {
    const span = document.createElement('span');
    span.className = 'clock-part';
    span.textContent = text;
    return span;
  };
  const grid = document.createElement('span');
  grid.className = 'clock-grid';
  grid.append(
    label,
    part(`${zp.hhmm}Z (${zp.weekday} ${Number(zp.day)})`),
    part(`${lp.hhmm}L (${lp.weekday} ${Number(lp.day)}) ${T.zoneLabel(state.zone)}`),
  );
  clockEl.replaceChildren(grid);
  if (!timelineTable.hidden) {
    for (const span of timelineBody.querySelectorAll('.countdown')) {
      span.textContent = T.formatCountdown(Number(span.dataset.target), now);
    }
  }
  if (document.hidden) return;
  clockTimer = setTimeout(tickClock, 60_000 - (now % 60_000) + 250);
}

function computeAll() {
  const tm = T.parseTimeHHMM(state.time);
  timeInput.classList.toggle('invalid', state.time.trim() !== '' && tm === null);
  takeoffMs = null;
  // The line under the entry boxes turns a Julian day into its calendar
  // day. A Julian day resolves to its next occurrence, so a mistyped one
  // lands months away; that is flagged.
  let resolvedText = null;
  let resolvedWarn = false;

  // Resolve the entered date to calendar components: the Zulu date in Zulu
  // mode, the local (selected-zone) date in local mode.
  let ymd = null;
  if (state.dateMode === 'calendar') {
    doyInput.classList.remove('invalid');
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(state.calDate);
    if (m) ymd = { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
  } else {
    const doy = T.parseJulianDay(state.doy);
    doyInput.classList.toggle('invalid', state.doy.trim() !== '' && doy === null);
    if (doy !== null) {
      const year = T.resolveJulianYear(doy, Date.now());
      if (year === null) {
        resolvedText = `Day ${doy} doesn't exist in the coming years.`;
        resolvedWarn = true;
      } else {
        const dd = new Date(Date.UTC(year, 0, doy));
        ymd = { y: year, mo: dd.getUTCMonth() + 1, d: dd.getUTCDate() };
        const p = T.zonedParts(dd.getTime(), 'UTC');
        const day = `${p.weekday} ${Number(p.day)} ${p.month} ${p.year}`;
        const at = dd.getTime() + (tm ? (tm.h * 60 + tm.m) * 60_000 : 0);
        resolvedWarn = at - Date.now() > FAR_TAKEOFF_DAYS * DAY_MS;
        resolvedText = resolvedWarn ? `>${FAR_TAKEOFF_DAYS} days in future: ${day}` : day;
      }
    }
  }

  if (ymd && tm !== null) {
    takeoffMs = state.timeMode === 'local'
      ? T.zoneWallToUtc(state.zone, ymd.y, ymd.mo, ymd.d, tm.h, tm.m)
      : Date.UTC(ymd.y, ymd.mo - 1, ymd.d, tm.h, tm.m);
  }

  computeLanding();

  resolvedEl.hidden = resolvedText === null;
  resolvedEl.textContent = resolvedText ?? '';
  resolvedEl.classList.toggle('warn', resolvedWarn);
  if (document.activeElement !== zoneInput) {
    zoneInput.value = zoneDisplayValue();
    zoneInput.scrollLeft = 0;
    fitZoneInput();
  }
  renderTimeline();
}

// Landing card: a landing time, Zulu or local (the next time that clock
// shows it after the takeoff), or a flight duration; a time shows the
// duration it works out to, and a duration shows the Zulu landing time.
const LANDING_ENTRY = { zulu: 'landingZulu', local: 'landingLocal', duration: 'landingDuration' };
function computeLanding() {
  landingMs = null;
  let label = '';
  let calc = '';
  let flag = '';
  let muted = false;
  const mode = state.landingMode;
  const raw = state[LANDING_ENTRY[mode]];
  const parsed = mode === 'duration' ? T.parseDuration(raw) : T.parseTimeHHMM(raw);
  landingInput.classList.toggle('invalid', raw.trim() !== '' && parsed === null);
  if (parsed !== null && takeoffMs === null) {
    calc = 'Needs a takeoff time';
    muted = true;
  } else if (parsed !== null) {
    // the day is flagged on the clock the entry was made in
    const zone = mode === 'local' ? state.zone : 'UTC';
    if (mode === 'duration') {
      landingMs = takeoffMs + parsed * 60_000;
      label = 'Lands';
      calc = `${T.zonedParts(landingMs, 'UTC').hhmm}Z`;
    } else {
      landingMs = T.nextWallTime(takeoffMs, zone, parsed.h, parsed.m);
      label = 'Duration';
      // HH:MM, the way a typed duration is shown
      const mins = Math.round((landingMs - takeoffMs) / 60_000);
      calc = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    }
    const lp = T.zonedParts(landingMs, zone);
    if (lp.dateKey !== T.zonedParts(takeoffMs, zone).dateKey) {
      flag = `(${lp.weekday} ${Number(lp.day)})`;
    }
  }
  landingCalcLabel.textContent = label || '\u00a0';
  landingCalc.replaceChildren(calc);
  if (flag) {
    const f = document.createElement('span');
    f.className = 'day-flag';
    f.textContent = flag;
    landingCalc.append(' ', f);
  }
  landingCalc.classList.toggle('muted', muted);
  if (document.activeElement !== landingInput) landingInput.value = raw;
  landingInput.placeholder = mode === 'duration' ? '08:35' : '1205';
  landingInputLabel.textContent = mode === 'duration' ? 'Flight duration'
    : mode === 'local' ? 'Landing time, local' : 'Landing time, Zulu';
  modeLZuluBtn.classList.toggle('active', mode === 'zulu');
  modeLLocalBtn.classList.toggle('active', mode === 'local');
  modeLDurBtn.classList.toggle('active', mode === 'duration');
}

// Shrink the zone field's font until the full value fits — a truncated
// "Pacific/Guam UTC+10" would read as UTC+1.
function fitZoneInput() {
  zoneInput.style.fontSize = '';
  let size = parseFloat(getComputedStyle(zoneInput).fontSize);
  while (zoneInput.scrollWidth > zoneInput.clientWidth && size > 9) {
    size -= 1;
    zoneInput.style.fontSize = `${size}px`;
  }
}

// The input shows the zone with its UTC offset, e.g. "Pacific/Guam UTC+10",
// computed at the takeoff instant when one is set so it's DST-correct.
function zoneDisplayValue() {
  return `${state.zone} ${T.utcOffsetLabel(takeoffMs ?? Date.now(), state.zone)}`;
}

function currentCopyText() {
  return T.buildCopyText(takeoffMs, timelineEvents(), [state.zone], { zulu: state.showZulu });
}

function renderCopyOptions() {
  copyZuluSwitch.setAttribute('aria-checked', String(state.showZulu));
  copyZuluState.textContent = state.showZulu ? 'Yes' : 'No';
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
  fitZoneInput();
}

function updateModeUI() {
  const cal = state.dateMode === 'calendar';
  doyInput.hidden = cal;
  calInput.hidden = !cal;
  modeJulianBtn.classList.toggle('active', !cal);
  modeCalBtn.classList.toggle('active', cal);
  const local = state.timeMode === 'local';
  modeZuluBtn.classList.toggle('active', !local);
  modeLocalBtn.classList.toggle('active', local);
  modeLocalBtn.disabled = !cal;
  dateLabel.textContent = !cal ? 'Julian day (Zulu)' : local ? 'Date (local)' : 'Date (Zulu)';
  timeLabel.textContent = local ? 'Time (local)' : 'Time (Zulu)';
}

function setDateMode(mode) {
  state.dateMode = mode;
  // going back to Calendar afterwards leaves Zulu chosen
  if (mode === 'julian') state.timeMode = 'zulu';
  saveState();
  updateModeUI();
  computeAll();
}

function setTimeMode(mode) {
  if (mode === 'local' && state.dateMode !== 'calendar') return;
  state.timeMode = mode;
  saveState();
  updateModeUI();
  computeAll();
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

// ---- template manager ---------------------------------------------------

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

function selectTemplate(id) {
  state.activeTemplateId = id;
  saveState();
  renderTemplateSelect();
  computeAll();
}

function renderTemplateList() {
  tplList.replaceChildren();
  if (!state.templates.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No templates yet — create one below.';
    tplList.append(empty);
    return;
  }
  for (const t of state.templates) {
    const item = document.createElement('div');
    item.className = 'tpl-item';

    const head = document.createElement('div');
    head.className = 'tpl-item-head';
    const nameEl = document.createElement('span');
    nameEl.className = 'tpl-item-name';
    nameEl.textContent = t.name || 'Untitled';
    const meta = document.createElement('span');
    meta.className = 'tpl-item-meta';
    const n = t.events.length;
    meta.textContent =
      `${n} event${n === 1 ? '' : 's'} + takeoff${t.includeLanding !== false ? ' + landing' : ''}`
      + `${t.id === state.activeTemplateId ? ' · in use' : ''}`;
    head.append(nameEl, meta);

    const actions = document.createElement('div');
    actions.className = 'tpl-item-actions';

    if (confirmDeleteId === t.id) {
      const label = document.createElement('span');
      label.className = 'tpl-confirm-label';
      label.textContent = 'Delete this template?';

      const yes = document.createElement('button');
      yes.type = 'button';
      yes.className = 'danger';
      yes.textContent = 'Delete';
      yes.addEventListener('click', () => {
        confirmDeleteId = null;
        state.templates = state.templates.filter((x) => x.id !== t.id);
        if (state.activeTemplateId === t.id) {
          state.activeTemplateId = state.templates[0]?.id ?? null;
        }
        saveState();
        renderTemplateList();
        renderTemplateSelect();
        computeAll();
      });

      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'ghost';
      no.textContent = 'Cancel';
      no.addEventListener('click', () => {
        confirmDeleteId = null;
        renderTemplateList();
      });

      actions.append(label, yes, no);
    } else {
      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.textContent = 'Use';
      useBtn.disabled = t.id === state.activeTemplateId;
      useBtn.addEventListener('click', () => {
        selectTemplate(t.id);
        closeManager();
      });

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => openEditorFor(t));

      const dupBtn = document.createElement('button');
      dupBtn.type = 'button';
      dupBtn.textContent = 'Duplicate';
      dupBtn.addEventListener('click', () => {
        state.templates.push({
          id: newId(),
          name: uniqueTemplateName(`${t.name} (copy)`),
          takeoffCountdown: t.takeoffCountdown === true,
          includeLanding: t.includeLanding !== false,
          landingCountdown: t.landingCountdown === true,
          events: t.events.map((e) => ({ ...e })),
        });
        saveState();
        renderTemplateList();
        renderTemplateSelect();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => {
        confirmDeleteId = t.id;
        renderTemplateList();
      });

      actions.append(useBtn, editBtn, dupBtn, delBtn);
    }

    item.append(head, actions);
    tplList.append(item);
  }
}

function renderTemplateEditor() {
  tplName.value = draft.name;
  tplEvents.replaceChildren();
  draft.events.forEach((ev, i) => {
    const row = document.createElement('div');
    row.className = 'ev-row';

    const nameIn = document.createElement('input');
    nameIn.className = 'ev-name';
    nameIn.value = ev.name;
    nameIn.placeholder = 'Event';
    nameIn.addEventListener('input', () => {
      ev.name = nameIn.value;
    });

    const offIn = document.createElement('input');
    offIn.className = 'ev-offset';
    offIn.value = ev.offset;
    offIn.placeholder = '-0:30';
    offIn.autocomplete = 'off';
    markOffsetValidity(offIn, ev.offset);
    offIn.addEventListener('input', () => {
      ev.offset = offIn.value;
      markOffsetValidity(offIn, ev.offset);
    });

    const cd = stopwatchToggle(
      () => ev.countdown === true,
      (on) => { ev.countdown = on; },
    );

    const del = document.createElement('button');
    del.className = 'row-x';
    del.type = 'button';
    del.textContent = '×';
    del.title = 'Remove event';
    del.addEventListener('click', () => {
      draft.events.splice(i, 1);
      renderTemplateEditor();
    });

    row.append(nameIn, offIn, cd, del);
    tplEvents.append(row);
  });
  tplTakeoffCdSlot.replaceChildren(stopwatchToggle(
    () => draft.takeoffCountdown === true,
    (on) => { draft.takeoffCountdown = on; },
  ));
  tplLandingInclude.checked = draft.includeLanding !== false;
  tplLandingCdSlot.replaceChildren(stopwatchToggle(
    () => draft.landingCountdown === true,
    (on) => { draft.landingCountdown = on; },
  ));
}

const STOPWATCH_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
  + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2"/>'
  + '<path d="M9.5 2.5h5"/><path d="M12 2.5v3.5"/><path d="M18.5 7.5l1.5-1.5"/></svg>';

// Amber when on (a user choice), grey when off. Tapping flips it.
function stopwatchToggle(get, set) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ev-cd';
  b.innerHTML = STOPWATCH_SVG;
  const sync = () => {
    const on = get();
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? 'Countdown on — tap to turn off' : 'Show a countdown for this event';
  };
  b.addEventListener('click', () => {
    set(!get());
    sync();
  });
  sync();
  return b;
}

function showListView() {
  tplEditorView.hidden = true;
  tplListView.hidden = false;
  renderTemplateList();
}

function showEditorView() {
  tplListView.hidden = true;
  tplEditorView.hidden = false;
  renderTemplateEditor();
}

function openEditorFor(tpl) {
  draft = {
    id: tpl.id,
    name: tpl.name,
    takeoffCountdown: tpl.takeoffCountdown === true,
    includeLanding: tpl.includeLanding !== false,
    landingCountdown: tpl.landingCountdown === true,
    events: tpl.events.map((e) => ({ ...e })),
  };
  draftIsNew = false;
  showEditorView();
}

function openEditorForNew() {
  draft = {
    id: newId(),
    name: uniqueTemplateName('New template'),
    takeoffCountdown: false,
    includeLanding: true,
    landingCountdown: false,
    events: [],
  };
  draftIsNew = true;
  showEditorView();
}

function saveDraft() {
  if (draftIsNew) {
    state.templates.push(draft);
  } else {
    const i = state.templates.findIndex((t) => t.id === draft.id);
    if (i >= 0) state.templates[i] = draft;
    else state.templates.push(draft);
  }
  if (!state.templates.some((t) => t.id === state.activeTemplateId)) {
    state.activeTemplateId = state.templates[0]?.id ?? null;
  }
  saveState();
  renderTemplateSelect();
  computeAll();
  draft = null;
  showListView();
}

function discardDraft() {
  draft = null;
  showListView();
}

function openManager() {
  confirmDeleteId = null;
  showListView();
  tplOverlay.hidden = false;
  document.body.classList.add('no-scroll');
}

function closeManager() {
  draft = null;
  tplOverlay.hidden = true;
  document.body.classList.remove('no-scroll');
  renderTemplateSelect();
  computeAll();
}

const pageEls = {};
const pageBtns = {};
for (const name of PAGES) {
  pageEls[name] = $(`${name}-page`);
  pageBtns[name] = $(`page-${name}`);
}
const szOverlay = $('sz-overlay');
const szList = $('sz-list');
const szAddInput = $('sz-add');
const slider = initSlider({
  stage: $('slider-stage'),
  rowsEl: $('slider-rows'),
  nowLine: $('slider-now-line'),
  nowTimeEl: $('slider-now-time'),
  nowBtn: $('slider-now'),
  takeoffBtn: $('slider-takeoff'),
  landingBtn: $('slider-landing'),
  minusBtn: $('slider-minus'),
  plusBtn: $('slider-plus'),
  // the device's real zone, not the Frag page's pick (which may be elsewhere)
  getLocalZone: () => deviceZone,
  getExtraZones: () => state.sliderZones,
  getTakeoffMs: () => takeoffMs,
  getLandingMs: () => landingMs,
});

// ---- slider zone editor --------------------------------------------------

function renderSzList() {
  szList.replaceChildren();
  const entries = [
    { zone: 'UTC', title: 'Zulu', locked: true },
    ...state.sliderZones.map((zone) => ({ zone, locked: false })),
  ];
  for (const r of entries) {
    const item = document.createElement('div');
    item.className = 'sz-item';
    const main = document.createElement('div');
    main.className = 'sz-main';
    const name = document.createElement('span');
    name.className = 'sz-name';
    name.textContent = r.title ?? T.zoneLabel(r.zone);
    const sub = document.createElement('span');
    sub.className = 'sz-sub';
    sub.textContent = `${r.zone} · ${T.utcOffsetLabel(Date.now(), r.zone)}`;
    main.append(name, sub);
    item.append(main);
    if (r.locked) {
      const lock = document.createElement('span');
      lock.className = 'sz-lock';
      lock.textContent = 'always shown';
      item.append(lock);
    } else {
      const del = document.createElement('button');
      del.className = 'row-x';
      del.type = 'button';
      del.textContent = '×';
      del.title = `Remove ${r.zone}`;
      del.addEventListener('click', () => {
        state.sliderZones = state.sliderZones.filter((z) => z !== r.zone);
        saveState();
        renderSzList();
      });
      item.append(del);
    }
    szList.append(item);
  }
}

function openSzEditor() {
  szAddInput.value = '';
  renderSzList();
  szOverlay.hidden = false;
  document.body.classList.add('no-scroll');
}

function closeSzEditor() {
  szOverlay.hidden = true;
  document.body.classList.remove('no-scroll');
  slider.open();
}

let currentPage = null;
function applyPage(page) {
  currentPage = page;
  // the app reopens on the working page last used, not on About
  if (page !== 'about') {
    state.page = page;
    saveState();
  }
  for (const name of PAGES) {
    pageEls[name].hidden = name !== page;
    pageBtns[name].classList.toggle('active', name === page);
    if (name === page) pageBtns[name].setAttribute('aria-current', 'page');
    else pageBtns[name].removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
  if (page === 'convert') slider.open();
  if (page === 'frag') fitZoneInput();
  if (page === 'about') renderZoneStamp();
}

// About page: ask for the data file now instead of at the next opening.
async function checkZoneDataNow() {
  zoneCheckBtn.disabled = true;
  zoneCheckResult.className = 'about-result';
  zoneCheckResult.textContent = 'Checking…';
  const result = await checkZoneData();
  afterZoneCheck(result);
  zoneCheckBtn.disabled = false;
  const version = T.zoneDataInfo()?.version;
  zoneCheckResult.classList.toggle('warn', result === 'failed');
  zoneCheckResult.textContent = result === 'updated' ? `Updated to ${version}.`
    : result === 'current' ? `Up to date (${version}).`
    : 'Couldn’t check. Go online and try again.';
}

function init() {
  $('version').textContent = VERSION.replace(/^v/, '');
  renderZoneStamp();
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
  timeInput.addEventListener('input', () => {
    state.time = timeInput.value;
    saveState();
    computeAll();
  });
  modeJulianBtn.addEventListener('click', () => setDateMode('julian'));
  modeCalBtn.addEventListener('click', () => setDateMode('calendar'));
  modeZuluBtn.addEventListener('click', () => setTimeMode('zulu'));
  modeLocalBtn.addEventListener('click', () => setTimeMode('local'));

  const setLandingMode = (mode) => {
    state.landingMode = mode;
    // each mode keeps its own entry; show it even if the box has focus
    landingInput.value = state[LANDING_ENTRY[mode]];
    saveState();
    computeAll();
  };
  modeLZuluBtn.addEventListener('click', () => setLandingMode('zulu'));
  modeLLocalBtn.addEventListener('click', () => setLandingMode('local'));
  modeLDurBtn.addEventListener('click', () => setLandingMode('duration'));
  // a duration gets its colon as it is typed, and is padded to HH:MM on leaving the box
  const setLandingEntry = (done) => {
    if (state.landingMode === 'duration') {
      landingInput.value = T.formatDurationEntry(landingInput.value, done);
    }
    state[LANDING_ENTRY[state.landingMode]] = landingInput.value;
    saveState();
    computeAll();
  };
  landingInput.addEventListener('input', () => setLandingEntry(false));
  landingInput.addEventListener('blur', () => setLandingEntry(true));
  tplLandingInclude.addEventListener('change', () => {
    draft.includeLanding = tplLandingInclude.checked;
  });

  createZonePicker({
    input: zoneInput,
    menu: suggestEl,
    isActive: (zid) => zid === state.zone,
    onPick: (zid) => setZone(zid),
    onEnterFallback: commitZone,
  });
  zoneInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (zoneInput.value.trim() !== zoneDisplayValue()) commitZone();
    }, 160);
  });
  deviceBtn.addEventListener('click', () => setZone(deviceZone));

  tplSelectBtn.addEventListener('click', () => {
    if (tplSelectMenu.hidden) showTplMenu(); else hideTplMenu();
  });
  document.addEventListener('click', (e) => {
    if (!tplSelectMenu.hidden && !e.target.closest('.tpl-select-wrap')) hideTplMenu();
  });
  $('tpl-manage-btn').addEventListener('click', openManager);
  $('tpl-done').addEventListener('click', closeManager);
  $('tpl-back').addEventListener('click', discardDraft);
  $('tpl-save').addEventListener('click', saveDraft);
  $('tpl-new').addEventListener('click', openEditorForNew);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!tplSelectMenu.hidden) { hideTplMenu(); return; }
    if (!szOverlay.hidden) { closeSzEditor(); return; }
    if (tplOverlay.hidden) return;
    if (!tplEditorView.hidden) discardDraft();
    else closeManager();
  });

  $('sz-edit').addEventListener('click', openSzEditor);
  $('sz-done').addEventListener('click', closeSzEditor);
  createZonePicker({
    input: szAddInput,
    menu: $('sz-suggest'),
    isActive: (zid) => zid === 'UTC' || state.sliderZones.includes(zid),
    onPick: (zid) => {
      if (zid !== 'UTC' && !state.sliderZones.includes(zid)) {
        state.sliderZones.push(zid);
        saveState();
      }
      szAddInput.value = '';
      renderSzList();
    },
  });
  window.addEventListener('resize', fitZoneInput);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    tickClock();
    renderZoneStamp();
    // a page left open for days asks again when it's looked at
    if (Date.now() - (zoneCheckedMs ?? 0) > ZONE_RECHECK_AFTER) checkZoneData().then(afterZoneCheck);
  });

  tplName.addEventListener('input', () => {
    draft.name = tplName.value;
  });
  $('tpl-add-event').addEventListener('click', () => {
    draft.events.push({ name: '', offset: '-1:00', countdown: false });
    renderTemplateEditor();
  });

  copyZuluSwitch.addEventListener('click', () => {
    state.showZulu = !state.showZulu;
    saveState();
    renderCopyOptions();
    renderTimeline();
  });
  renderCopyOptions();

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

  // page navigation, synced to the URL hash so the phone's back button
  // flips pages instead of leaving the app
  for (const name of PAGES) {
    pageBtns[name].addEventListener('click', () => { location.hash = name; });
  }
  window.addEventListener('hashchange', () => {
    const page = pageFromName(location.hash.slice(1)) ?? 'frag';
    if (location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
    applyPage(page);
  });
  zoneCheckBtn.addEventListener('click', checkZoneDataNow);

  computeAll();

  const initialPage = pageFromName(location.hash.slice(1)) ?? state.page;
  history.replaceState(null, '', `#${initialPage}`);
  applyPage(initialPage);
}

// ---- zone data: saved copy and update check --------------------------------
// The app converts with its own copy of the time zone rules. It keeps the
// last good copy of data/tzdata.json on the device and starts from that,
// so it opens at once and works offline. It then asks the site for the
// current file: whatever valid file the site serves replaces the saved
// one (the site is the authority, so a bad release can be rolled back),
// and the time of that answer is kept so the page can warn when the data
// has gone too long unchecked. With no copy at all the device's own
// rules are used, and the page says so (see renderZoneNote).

function loadSavedZoneData() {
  try {
    const text = localStorage.getItem(ZONE_DATA_KEY);
    return text !== null && T.setZoneData(JSON.parse(text));
  } catch {
    return false;
  }
}

// Ask the site for the current data file. Resolves 'updated' when the
// rules in use changed as a result, 'current' when the site has the copy
// already in use, 'failed' when there was no usable answer. Callers that
// overlap share one request.
let zoneCheck = null;
function checkZoneData() {
  zoneCheck ??= fetchZoneData().finally(() => { zoneCheck = null; });
  return zoneCheck;
}

async function fetchZoneData() {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15_000);
  try {
    const res = await fetch('data/tzdata.json', { cache: 'no-cache', signal: abort.signal });
    if (!res.ok) return 'failed';
    const text = await res.text();
    const data = JSON.parse(text);
    const have = T.zoneDataInfo();
    const same = have !== null && data.version === have.version && data.built === have.built;
    // a file that fails its checks changes nothing and doesn't count as a check
    if (!same && !T.setZoneData(data)) return 'failed';
    zoneCheckedMs = Date.now();
    try {
      if (!same) localStorage.setItem(ZONE_DATA_KEY, text);
      localStorage.setItem(ZONE_CHECK_KEY, String(zoneCheckedMs));
    } catch { /* storage full or unavailable: fine for this visit */ }
    return same ? 'current' : 'updated';
  } catch {
    return 'failed';   // offline, blocked, too slow or unreadable
  } finally {
    clearTimeout(timer);
  }
}

function afterZoneCheck(result) {
  renderZoneStamp();
  if (result === 'updated') {
    computeAll();
    if (currentPage === 'convert') slider.open();
  } else {
    renderTimeline();
  }
}

// Straight in when there is a saved copy. On a first visit, wait for the
// file, but not for long: a slow connection starts the page on the
// device's rules (flagged) and it redraws once the file arrives.
let started = false;
function start() {
  if (started) return;
  started = true;
  init();
}
if (loadSavedZoneData()) start();
else setTimeout(start, 3000);
checkZoneData().then((result) => {
  if (started) afterZoneCheck(result);
  start();
});
