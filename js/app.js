// The ?v= query on this import and on the <script>/<link> tags in
// index.html must move together each release — it pins the browser
// cache so a new HTML page can never run against stale JS.
import * as T from './time-engine.js?v=0.9.0';
import { initSlider } from './slider.js?v=0.9.0';

const VERSION = 'v0.9.0';
const RELEASED = '2026-10-06';   // the day this version went live; moves with VERSION
const STORAGE_KEY = 'att-state-v1';
const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// minutes from takeoff
const DEFAULT_TEMPLATE_EVENTS = [
  { name: 'Stop drink', offsetMin: -720 },
  { name: 'LFA', offsetMin: -255 },
  { name: 'Bus', offsetMin: -195 },
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
    events: DEFAULT_TEMPLATE_EVENTS.map((e) => ({ id: newId(), source: 'takeoff', countdown: false, ...e })),
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

// A template's events as the app keeps them: {id, name, source, offsetMin,
// countdown}, where source is 'takeoff', 'landing' or another event's id
// (see "sequence of events" in time-engine.js). Versions before sources
// kept a signed text such as "-4:15", always counted from takeoff.
function sanitizeEvents(raw) {
  const events = [];
  const ids = new Set();
  for (const e of raw) {
    if (!e || typeof e.name !== 'string') continue;
    const offsetMin = Number.isInteger(e.offsetMin) ? e.offsetMin
      : typeof e.offset === 'string' ? T.parseOffset(e.offset)
      : null;
    if (offsetMin === null) continue;
    const id = typeof e.id === 'string' && e.id && !ids.has(e.id)
      && e.id !== 'takeoff' && e.id !== 'landing' ? e.id : newId();
    ids.add(id);
    events.push({
      id,
      name: e.name,
      source: typeof e.source === 'string' ? e.source : 'takeoff',
      offsetMin,
      countdown: e.countdown === true,
    });
  }
  // a source that isn't there, or that leads back to the event itself,
  // falls back to takeoff
  for (const e of events) {
    const known = e.source === 'takeoff' || e.source === 'landing'
      || (e.source !== e.id && ids.has(e.source));
    if (!known || T.eventDependsOn(events, e.id, e.id)) e.source = 'takeoff';
  }
  return events;
}

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
      events: sanitizeEvents(t.events),
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

// The SOEs page's rows: the active template's events plus the takeoff,
// which is always there, and the landing when there is one. Each has its
// instant (null while it can't be worked out) and, for a template event,
// where that comes from: "Takeoff − 3:15", "Show + 16:00". In time order;
// rows without a time go last, in template order. Needs a takeoff.
function timelineEvents() {
  const tpl = activeTemplate();
  const events = tpl ? tpl.events : [];
  const times = T.resolveEventTimes(events, takeoffMs, landingMs);
  const nameOf = (e) => e.name.trim() || 'Event';
  const sourceName = (source) => (source === 'takeoff' ? 'Takeoff'
    : source === 'landing' ? 'Landing'
    : nameOf(events.find((e) => e.id === source)));
  const rows = events.map((e) => ({
    name: nameOf(e),
    ms: times.get(e.id),
    from: `${sourceName(e.source)} ${e.offsetMin < 0 ? '\u2212' : '+'} ${T.minutesToHMM(e.offsetMin)}`,
    countdown: e.countdown === true,
  }));
  rows.push({ name: 'Takeoff', ms: takeoffMs, countdown: tpl?.takeoffCountdown === true });
  if (landingMs !== null && tpl?.includeLanding !== false) {
    rows.push({ name: 'Landing', ms: landingMs, countdown: tpl?.landingCountdown === true });
  }
  return rows.sort((a, b) => (a.ms === null) - (b.ms === null) || (a.ms ?? 0) - (b.ms ?? 0));
}

const $ = (id) => document.getElementById(id);
const doyInput = $('doy');
const calInput = $('caldate');
const modeJulianBtn = $('mode-julian');
const modeCalBtn = $('mode-cal');
const modeZuluBtn = $('mode-zulu');
const modeLocalBtn = $('mode-local');
const landingInput = $('landing-input');
const landingCalc = $('landing-calc');
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
const appCheckBtn = $('app-check-btn');
const appCheckResult = $('app-check-result');
const zoneInput = $('zone-input');
const suggestEl = $('zone-suggest');
const timelineEl = $('timeline');
const copyBtn = $('copy-btn');
const copyZuluSwitch = $('copy-zulu');
const copyZuluState = $('copy-zulu-state');
const copyOverlay = $('copy-overlay');
const copyPreview = $('copy-preview');
const copyDoBtn = $('copy-do');
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
const tplLandingCdSlot = $('tpl-landing-cd');
const tplLandingInclude = $('tpl-landing-include');

// The editor works on a draft copy; Save commits it, ‹ Templates discards.
let draft = null;
let draftIsNew = false;
// The draft event open for editing in the editor's list, if any.
let openEventId = null;
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

// "2026-09-29" → "29 Sep 2026".
function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
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
  // the release name in white; its date and the check in grey, the check
  // in orange once it is overdue
  const released = info.released ? ` of ${prettyDate(info.released)}` : '';
  const muted = (text, cls) => {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    return span;
  };
  zoneStamp.classList.remove('warn');
  zoneStamp.replaceChildren(
    `IANA release ${info.version}`,
    muted(released, 'about-muted'),
    muted(checked, stale ? 'about-warn' : 'about-muted'),
  );
  zoneDetail.textContent = `Built ${prettyDate(info.built)}. `
    + `Covers ${new Date(info.fromMs).getUTCFullYear()}–${new Date(info.untilMs - 1).getUTCFullYear()}.`;
}

// A small element with a class and, usually, some text.
function el(cls, text = '') {
  const node = document.createElement('div');
  node.className = cls;
  node.textContent = text;
  return node;
}

function renderTimeline() {
  copyBtn.disabled = takeoffMs === null;
  soeEmpty.hidden = takeoffMs !== null;
  timelineEl.hidden = takeoffMs === null;
  timelineEl.replaceChildren();
  if (takeoffMs === null) {
    renderZoneNote([]);
    tickCountdowns();
    return;
  }

  const rows = timelineEvents().map((ev) => (ev.ms === null ? { ev } : {
    ev, zp: T.zonedParts(ev.ms, 'UTC'), lp: T.zonedParts(ev.ms, state.zone),
  }));
  const timed = rows.filter((r) => r.ev.ms !== null);
  renderZoneNote(timed.map((r) => r.ev.ms));
  // All-or-nothing day labels: if more than one calendar day appears in
  // the sequence (in either column), every time states its day; when
  // everything shares one day, none do.
  const showDays = new Set(timed.flatMap((r) => [r.zp.dateKey, r.lp.dateKey])).size > 1;
  const dayText = (p) => `${p.weekday} ${Number(p.day)}`;

  for (const { ev, zp, lp } of rows) {
    const name = el('soe-name', ev.name);
    if (ev.countdown && ev.ms !== null) {
      const cd = document.createElement('span');
      cd.className = 'soe-countdown';
      cd.dataset.target = String(ev.ms);
      name.append(' ', cd);
    }
    const left = el('soe-left');
    left.append(name);
    // takeoff and landing come from the Frag page, not from an offset
    if (ev.from) left.append(el('soe-off', ev.from));
    const main = el('soe-main');
    const row = el('soe-row');
    if (ev.ms === null) {
      // only a missing landing leaves a time open
      row.classList.add('pending');
      main.append(left, el('soe-needs', 'Needs flight duration'));
    } else {
      const times = el('soe-times');
      times.append(el('soe-time', `${lp.hhmm}L`), el('soe-sep', '/'), el('soe-time', `${zp.hhmm}Z`));
      if (showDays) times.append(el('soe-day', dayText(lp)), el('soe-sep'), el('soe-day', dayText(zp)));
      main.append(left, times);
    }
    row.append(main);
    timelineEl.append(row);
  }
  tickCountdowns();
}

// The countdowns refresh on the wall-clock minute (plus a small margin so
// the rounding in formatCountdown lands on the new minute), and
// immediately when the tab comes back to the foreground — background
// timers throttle.
let countdownTimer = null;
function tickCountdowns() {
  clearTimeout(countdownTimer);
  const spans = timelineEl.querySelectorAll('.soe-countdown');
  const now = Date.now();
  for (const span of spans) {
    span.textContent = T.formatCountdown(Number(span.dataset.target), now);
  }
  if (document.hidden || !spans.length) return;
  countdownTimer = setTimeout(tickCountdowns, 60_000 - (now % 60_000) + 250);
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

// Flight duration card: the landing it works out to, in Zulu and local.
function computeLanding() {
  landingMs = null;
  const raw = state.landingDuration;
  const parsed = T.parseDuration(raw);
  landingInput.classList.toggle('invalid', raw.trim() !== '' && parsed === null);
  let text = '';
  if (parsed !== null && takeoffMs === null) {
    text = 'Needs a takeoff time';
  } else if (parsed !== null) {
    landingMs = takeoffMs + parsed * 60_000;
    const zones = ['UTC', state.zone];
    const [lz, ll] = zones.map((zone) => T.zonedParts(landingMs, zone));
    const [tz, tl] = zones.map((zone) => T.zonedParts(takeoffMs, zone));
    // as on the SOEs page, the day goes on both times or on neither
    const flagged = lz.dateKey !== tz.dateKey || ll.dateKey !== tl.dateKey;
    const day = (p) => (flagged ? ` (${p.weekday} ${Number(p.day)})` : '');
    text = `Lands ${lz.hhmm}Z${day(lz)} / ${ll.hhmm}L${day(ll)}`;
  }
  landingCalc.hidden = text === '';
  landingCalc.textContent = text;
  landingCalc.classList.toggle('empty', landingMs === null);
  if (document.activeElement !== landingInput) landingInput.value = raw;
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

// The lines offered for copying: a header naming the local zone, then
// every event that has a time.
function copyLines() {
  const events = timelineEvents().filter((ev) => ev.ms !== null);
  return T.buildCopyLines(takeoffMs, events, [state.zone], { zulu: state.showZulu });
}

// Lines unticked in the copy popup, by position. Every line is ticked
// again each time the popup opens.
const copyLeftOut = new Set();

// The text Copy puts on the clipboard: the lines still ticked.
function currentCopyText() {
  return copyLines().filter((_, i) => !copyLeftOut.has(i)).join('\n');
}

// Copy popup: the format options, then each line as it will be copied
// beside the checkbox that keeps it in.
function renderCopyOptions() {
  copyZuluSwitch.setAttribute('aria-checked', String(state.showZulu));
  copyZuluState.textContent = state.showZulu ? 'Yes' : 'No';
  const lines = takeoffMs === null ? [] : copyLines();
  copyPreview.replaceChildren(...lines.map((line, i) => {
    const row = document.createElement('label');
    row.className = 'copy-line';
    const text = document.createElement('span');
    text.className = 'copy-line-text';
    text.textContent = line;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !copyLeftOut.has(i);
    box.setAttribute('aria-label', `Include: ${line}`);
    const sync = () => {
      row.classList.toggle('left-out', !box.checked);
      copyDoBtn.disabled = copyLeftOut.size >= lines.length;
    };
    box.addEventListener('change', () => {
      if (box.checked) copyLeftOut.delete(i); else copyLeftOut.add(i);
      sync();
    });
    sync();
    row.append(text, box);
    return row;
  }));
}

function openCopy() {
  if (takeoffMs === null) return;
  copyLeftOut.clear();
  renderCopyOptions();
  copyOverlay.hidden = false;
  document.body.classList.add('no-scroll');
}

let copyCloseTimer = null;
function closeCopy() {
  clearTimeout(copyCloseTimer);
  copyOverlay.hidden = true;
  copyDoBtn.textContent = 'Copy';
  document.body.classList.remove('no-scroll');
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

// The editor's copy of an event keeps the offset as typed, with before or
// after chosen beside it, so a half-typed entry is not lost.
function toDraftEvent(e) {
  return {
    id: e.id,
    name: e.name,
    source: e.source,
    after: e.offsetMin > 0,
    offsetText: T.minutesToHMM(e.offsetMin),
    countdown: e.countdown === true,
  };
}

// Signed minutes of a draft event; null while its offset can't be read.
function draftOffsetMin(d) {
  const size = T.parseOffsetEntry(d.offsetText);
  if (size === null) return null;
  return d.after ? size : -size || 0;
}

// Back to the saved form; null while the offset can't be read.
function fromDraftEvent(d) {
  const offsetMin = draftOffsetMin(d);
  if (offsetMin === null) return null;
  return { id: d.id, name: d.name, source: d.source, offsetMin, countdown: d.countdown === true };
}

// Take an event out of the draft. Events that counted from it now count
// from what it counted from, with its offset added to theirs, so their
// times stay where they were.
function removeDraftEvent(gone) {
  const goneMin = draftOffsetMin(gone) ?? 0;
  for (const ev of draft.events) {
    if (ev.source !== gone.id) continue;
    ev.source = gone.source;
    const own = draftOffsetMin(ev);
    if (own === null) continue;
    ev.after = own + goneMin > 0;
    ev.offsetText = T.minutesToHMM(own + goneMin);
  }
  draft.events = draft.events.filter((ev) => ev !== gone);
}

// What an event may count from: takeoff, landing, and any other event
// that doesn't itself depend on this one (which would make a loop).
function sourceOptions(ev) {
  return [
    ['takeoff', 'Takeoff'],
    ['landing', 'Landing'],
    ...draft.events
      .filter((o) => o.id !== ev.id && !T.eventDependsOn(draft.events, o.id, ev.id))
      .map((o) => [o.id, o.name.trim() || 'Unnamed event']),
  ];
}

// "Takeoff − 3:15": a draft event's line in the list.
function draftFromText(d) {
  const source = d.source === 'takeoff' ? 'Takeoff'
    : d.source === 'landing' ? 'Landing'
    : (draft.events.find((o) => o.id === d.source)?.name.trim() || 'Unnamed event');
  return `${source} ${d.after ? '+' : '\u2212'} ${d.offsetText.trim() || '?'}`;
}

// The editor lists events in time order, as the SOEs page does. Without a
// flight duration, what hangs off the landing goes after everything else.
// Returns each event's place on that scale, where the takeoff is 0.
function sortDraftEvents() {
  const flight = takeoffMs !== null && landingMs !== null ? landingMs - takeoffMs : 1e12;
  const times = T.resolveEventTimes(
    draft.events.map((d) => ({ id: d.id, source: d.source, offsetMin: draftOffsetMin(d) ?? 0 })),
    0, flight,
  );
  const at = (d) => times.get(d.id) ?? 1e15;
  draft.events.sort((a, b) => at(a) - at(b));
  return at;
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

// One event is open for editing at a time; the rest are lines to tap.
// The list is put back in time order whenever it is redrawn, which never
// happens while an event's fields are being typed in. The takeoff is in
// the list at its place in time: it can't be renamed, retimed or deleted,
// only given a countdown.
function renderTemplateEditor({ focusName = false } = {}) {
  tplName.value = draft.name;
  const at = sortDraftEvents();
  tplEvents.replaceChildren();
  let takeoffPlaced = false;
  const placeTakeoff = () => {
    tplEvents.append(openEventId === 'takeoff' ? renderOpenTakeoff() : summaryItem({
      id: 'takeoff',
      name: 'Takeoff',
      sub: 'From the Frag page',
      countdown: draft.takeoffCountdown === true,
    }));
    takeoffPlaced = true;
  };
  for (const ev of draft.events) {
    if (!takeoffPlaced && at(ev) > 0) placeTakeoff();
    tplEvents.append(ev.id === openEventId ? renderOpenEvent(ev) : summaryItem({
      id: ev.id,
      name: ev.name.trim(),
      sub: draftFromText(ev),
      subInvalid: draftOffsetMin(ev) === null,
      countdown: ev.countdown === true,
    }));
  }
  if (!takeoffPlaced) placeTakeoff();
  const openItem = tplEvents.querySelector('.ev-item.open');
  if (openItem) {
    openItem.scrollIntoView({ block: 'nearest' });
    if (focusName) openItem.querySelector('.ev-name')?.focus();
  }
  tplLandingInclude.checked = draft.includeLanding !== false;
  tplLandingCdSlot.replaceChildren(stopwatchToggle(
    () => draft.landingCountdown === true,
    (on) => { draft.landingCountdown = on; },
  ));
}

function iconSpan(cls, svg) {
  const span = document.createElement('span');
  span.className = cls;
  span.innerHTML = svg;
  return span;
}

// An event in the list: its name over where its time comes from. Tapping
// it opens it.
function summaryItem({ id, name, sub, subInvalid = false, countdown }) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'ev-item ev-summary';
  const text = document.createElement('span');
  text.className = 'ev-sum-text';
  const nameEl = document.createElement('span');
  nameEl.className = 'ev-sum-name';
  nameEl.textContent = name || 'Unnamed event';
  nameEl.classList.toggle('unnamed', name === '');
  const subEl = document.createElement('span');
  subEl.className = 'ev-sum-from';
  subEl.textContent = sub;
  subEl.classList.toggle('invalid', subInvalid);
  text.append(nameEl, subEl);
  item.append(text);
  if (countdown) item.append(iconSpan('ev-sum-cd', STOPWATCH_SVG));
  item.append(iconSpan('ev-chev', CHEVRON_SVG));
  item.addEventListener('click', () => {
    openEventId = id;
    renderTemplateEditor();
  });
  return item;
}

// The arrow that closes the open event.
function closeEventButton() {
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ev-close';
  close.title = 'Close';
  close.setAttribute('aria-label', 'Close this event');
  close.append(iconSpan('ev-chev up', CHEVRON_SVG));
  close.addEventListener('click', () => {
    openEventId = null;
    renderTemplateEditor();
  });
  return close;
}

// "Countdown on" / "Countdown off", amber when on.
function countdownButton(get, set) {
  const cd = document.createElement('button');
  cd.type = 'button';
  cd.className = 'ev-cd-wide';
  const text = document.createElement('span');
  cd.append(iconSpan('', STOPWATCH_SVG), text);
  const sync = () => {
    cd.setAttribute('aria-pressed', String(get()));
    text.textContent = get() ? 'Countdown on' : 'Countdown off';
  };
  cd.addEventListener('click', () => {
    set(!get());
    sync();
  });
  sync();
  return cd;
}

// The takeoff, open: only its countdown can be changed.
function renderOpenTakeoff() {
  const top = el('ev-line');
  top.append(el('ev-fixed-name', 'Takeoff'), closeEventButton());
  const foot = el('ev-line ev-foot');
  foot.append(countdownButton(
    () => draft.takeoffCountdown === true,
    (on) => { draft.takeoffCountdown = on; },
  ));
  const item = el('ev-item open');
  item.append(top, foot);
  return item;
}

// An event, open: its name; then "3:15 before Takeoff" as three fields;
// then its countdown and Delete.
function renderOpenEvent(ev) {
  const nameIn = document.createElement('input');
  nameIn.className = 'ev-name';
  nameIn.value = ev.name;
  nameIn.placeholder = 'Event name';
  nameIn.autocomplete = 'off';
  nameIn.addEventListener('input', () => {
    ev.name = nameIn.value;
  });

  const offIn = document.createElement('input');
  offIn.className = 'ev-offset';
  offIn.value = ev.offsetText;
  offIn.placeholder = '1:00';
  offIn.inputMode = 'numeric';
  offIn.maxLength = 6;
  offIn.autocomplete = 'off';
  offIn.setAttribute('aria-label', 'Hours and minutes');
  const mark = () => offIn.classList.toggle('invalid', T.parseOffsetEntry(ev.offsetText) === null);
  // the colon appears as it is typed; leaving the box tidies it to H:MM
  offIn.addEventListener('input', () => {
    offIn.value = T.formatDurationEntry(offIn.value);
    ev.offsetText = offIn.value;
    mark();
  });
  offIn.addEventListener('blur', () => {
    const size = T.parseOffsetEntry(ev.offsetText);
    if (size !== null) ev.offsetText = offIn.value = T.minutesToHMM(size);
  });
  mark();

  const when = document.createElement('button');
  when.type = 'button';
  when.className = 'ev-when';
  const syncWhen = () => {
    when.textContent = ev.after ? 'after' : 'before';
    when.title = ev.after ? 'Tap for before' : 'Tap for after';
  };
  when.addEventListener('click', () => {
    ev.after = !ev.after;
    syncWhen();
  });
  syncWhen();

  const select = document.createElement('select');
  select.className = 'ev-source';
  select.setAttribute('aria-label', 'Counts from');
  for (const [value, label] of sourceOptions(ev)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.append(opt);
  }
  select.value = ev.source;
  select.addEventListener('change', () => {
    ev.source = select.value;
  });

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'danger';
  del.textContent = 'Delete';
  del.addEventListener('click', () => {
    removeDraftEvent(ev);
    openEventId = null;
    renderTemplateEditor();
  });

  const top = el('ev-line');
  top.append(nameIn, closeEventButton());
  const sentence = el('ev-line');
  sentence.append(offIn, when, select);
  const foot = el('ev-line ev-foot');
  foot.append(countdownButton(
    () => ev.countdown === true,
    (on) => { ev.countdown = on; },
  ), del);
  const item = el('ev-item open');
  item.append(top, sentence, foot);
  return item;
}

const CHEVRON_SVG =
  '<svg viewBox="0 0 12 8" width="12" height="8" fill="none" stroke="currentColor" '
  + 'stroke-width="2" aria-hidden="true"><path d="M1 1l5 5 5-5"/></svg>';

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
    events: tpl.events.map(toDraftEvent),
  };
  openEventId = null;
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
  openEventId = null;
  draftIsNew = true;
  showEditorView();
}

function saveDraft() {
  const events = draft.events.map(fromDraftEvent);
  if (events.includes(null)) {
    // an offset can't be read: open that event and keep the editor up
    openEventId = draft.events[events.indexOf(null)].id;
    renderTemplateEditor();
    flash($('tpl-save'), 'Check offsets');
    return;
  }
  const tpl = { ...draft, events };
  if (draftIsNew) {
    state.templates.push(tpl);
  } else {
    const i = state.templates.findIndex((t) => t.id === tpl.id);
    if (i >= 0) state.templates[i] = tpl;
    else state.templates.push(tpl);
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

// About page: ask the site which version of the app it serves now. In a
// plain browser tab a newer one is offered by reloading; installed as an
// app, the service worker fetches it for the next launch.
async function checkAppVersionNow() {
  appCheckBtn.disabled = true;
  appCheckResult.className = 'about-result';
  appCheckResult.replaceChildren('Checking…');
  let latest = null;
  try {
    const res = await fetch('index.html', { cache: 'no-cache' });
    if (res.ok) latest = /js\/app\.js\?v=([\w.-]+)/.exec(await res.text())?.[1] ?? null;
  } catch { /* offline, blocked or unreadable */ }
  appCheckBtn.disabled = false;
  const mine = VERSION.replace(/^v/, '');
  if (latest === null) {
    appCheckResult.classList.add('warn');
    appCheckResult.replaceChildren('Couldn’t check. Go online and try again.');
  } else if (latest === mine) {
    appCheckResult.replaceChildren('You are running the latest version.');
  } else if (navigator.serviceWorker?.controller) {
    // installed as an app: the new version is fetched in the background
    // and takes over at the next launch (see sw.js)
    try { await (await navigator.serviceWorker.getRegistration())?.update(); } catch { /* best effort */ }
    appCheckResult.replaceChildren(`Version ${latest} is downloading. It will be ready the next time you open the app.`);
  } else {
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'ghost';
    reload.textContent = 'Reload to update';
    reload.addEventListener('click', () => location.reload());
    appCheckResult.replaceChildren(`Version ${latest} is available. `, reload);
  }
}

function init() {
  $('version').textContent = VERSION.replace(/^v/, '');
  $('released').textContent = `released ${prettyDate(RELEASED)}`;
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

  // a duration gets its colon as it is typed, and is padded to HH:MM on leaving the box
  const setLandingEntry = (done) => {
    landingInput.value = T.formatDurationEntry(landingInput.value, done);
    state.landingDuration = landingInput.value;
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
    if (!copyOverlay.hidden) { closeCopy(); return; }
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
    tickCountdowns();
    renderZoneStamp();
    // a page left open for days asks again when it's looked at
    if (Date.now() - (zoneCheckedMs ?? 0) > ZONE_RECHECK_AFTER) checkZoneData().then(afterZoneCheck);
  });

  tplName.addEventListener('input', () => {
    draft.name = tplName.value;
  });
  $('tpl-add-event').addEventListener('click', () => {
    const ev = {
      id: newId(), name: '', source: 'takeoff', after: false, offsetText: '1:00', countdown: false,
    };
    draft.events.push(ev);
    openEventId = ev.id;
    renderTemplateEditor({ focusName: true });
  });

  copyBtn.addEventListener('click', openCopy);
  $('copy-close').addEventListener('click', closeCopy);
  copyZuluSwitch.addEventListener('click', () => {
    state.showZulu = !state.showZulu;
    saveState();
    renderCopyOptions();
  });
  copyDoBtn.addEventListener('click', async () => {
    const text = currentCopyText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      fallbackCopy(text);
    }
    copyDoBtn.textContent = 'Copied ✓';
    // long enough to read the tick, then back to the page
    clearTimeout(copyCloseTimer);
    copyCloseTimer = setTimeout(closeCopy, 900);
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
  appCheckBtn.addEventListener('click', checkAppVersionNow);

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

// Keep a copy of the app on the device, for instant starts and offline
// use (sw.js). Browsers only allow this over HTTPS or on localhost; the
// app is the same without it.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => { /* not available here */ });
}
checkZoneData().then((result) => {
  if (started) afterZoneCheck(result);
  start();
});
