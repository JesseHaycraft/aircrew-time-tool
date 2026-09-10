// Slider page: stacked per-zone day bars dragged under a fixed center
// line. The line is the selected instant; bars carry local-day segments
// whose widths come from real midnight boundaries (23/25 h across DST),
// tinted by calendar day with the night hours darker.
import * as T from './time-engine.js?v=0.4.6';
import { zoneCoords } from './zone-coords.js?v=0.4.6';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const PX_PER_HOUR = 32;              // ≈12 hours visible on a phone screen
const PX_PER_MS = PX_PER_HOUR / HOUR;
const READOUT_STEP = 5 * MINUTE;     // readouts round to this; the slider itself is 1-minute
const COVER_MS = 24 * HOUR;          // segments are built for t0 ± this
const REBUILD_MS = 12 * HOUR;        // rebuild when the drag strays this far
const LABEL_GAP_R = 10;              // px from the cursor line to a label on its right
const LABEL_GAP_L = 20;              // px from a label on the left to the cursor line
const LABEL_INSET = 16;              // px from a day's end to its label when off the cursor
const FLING_TAU = 2000;              // ms; velocity decays by e every this long
const FLING_MIN_PX_S = 50;           // slower releases than this don't fling
const FLING_STOP_PX_S = 3;           // coasting ends below this speed
const VELOCITY_WINDOW = 100;         // ms of pointer history used for the fling velocity
const GREENWICH = [51.48, 0];        // Zulu has no place; shade its nights by Greenwich

export function initSlider({
  stage, rowsEl, nowLine, nowTimeEl, nowBtn, takeoffBtn, minusBtn, plusBtn,
  getLocalZone, getExtraZones, getTakeoffMs,
}) {
  let sliderT = null;    // selected instant (ms epoch)
  let mode = 'now';      // 'now' follows the clock, 'takeoff' sits on it, null = free
  let seededFrom = null; // takeoff value the slider last seeded itself from
  let t0 = null;         // reference instant the strips were built around
  let rows = [];
  let rafPending = false;

  const snapTo = (ms, step) => Math.round(ms / step) * step;
  const nowMin = () => snapTo(Date.now(), MINUTE);
  let fling = null;      // { v: slider ms per real ms, last: performance.now(), pos: float ms }

  function rowDefs() {
    return [
      { zone: 'UTC', name: 'Zulu', coords: GREENWICH },
      ...getExtraZones().map((zone) => ({ zone, name: null, coords: zoneCoords(zone) })),
    ];
  }

  function buildRows() {
    rowsEl.replaceChildren();
    rows = rowDefs().map((def) => {
      const row = document.createElement('div');
      row.className = 'sl-row';

      const info = document.createElement('div');
      info.className = 'sl-info';
      const label = document.createElement('div');
      label.className = 'sl-label';
      const nameEl = document.createElement('span');
      nameEl.className = 'sl-name';
      nameEl.textContent = def.name ?? T.zoneRegionName(Date.now(), def.zone);
      const subEl = document.createElement('span');
      subEl.className = 'sl-sub';
      label.append(nameEl, subEl);
      const timeEl = document.createElement('div');
      timeEl.className = 'sl-time';
      info.append(label, timeEl);

      const track = document.createElement('div');
      track.className = 'sl-track';
      const strip = document.createElement('div');
      strip.className = 'sl-strip';
      track.append(strip);

      row.append(info, track);
      rowsEl.append(row);
      return { ...def, subEl, timeEl, strip, segs: [] };
    });
  }

  function buildSegments() {
    t0 = sliderT;
    const w = stage.clientWidth;
    for (const row of rows) {
      row.strip.replaceChildren();
      row.segs = [];
      const from = t0 - COVER_MS;
      const to = t0 + COVER_MS;
      const nights = row.coords ? T.nightIntervals(from, to, row.coords[0], row.coords[1]) : [];
      for (const seg of T.daySegments(row.zone, from, to)) {
        const el = document.createElement('div');
        // three tints cycle by calendar day, so the same date shares a
        // tint on every row
        el.className = `sl-seg c${((seg.epochDay % 3) + 3) % 3}`;
        const left = (seg.start - t0) * PX_PER_MS + w / 2;
        const width = (seg.end - seg.start) * PX_PER_MS;
        el.style.left = `${left}px`;
        el.style.width = `${width}px`;
        for (const [ns, ne] of nights) {
          const s = Math.max(ns, seg.start);
          const e = Math.min(ne, seg.end);
          if (e <= s) continue;
          const night = document.createElement('div');
          night.className = 'sl-night';
          night.style.left = `${(s - seg.start) * PX_PER_MS}px`;
          night.style.width = `${(e - s) * PX_PER_MS}px`;
          el.append(night);
        }
        const lab = document.createElement('span');
        lab.className = 'sl-seg-label';
        lab.textContent = `${seg.weekday} ${Number(seg.day)} ${seg.month}`;
        el.append(lab);
        row.strip.append(el);
        row.segs.push({ lab, left, width, labW: 0 });
      }
      for (const s of row.segs) s.labW = Math.ceil(s.lab.offsetWidth);
    }
  }

  function render() {
    rafPending = false;
    const w = stage.clientWidth;
    const shift = (t0 - sliderT) * PX_PER_MS;
    for (const row of rows) {
      row.strip.style.transform = `translateX(${shift}px)`;

      row.timeEl.textContent = T.zonedParts(snapTo(sliderT, READOUT_STEP), row.zone).hhmm;
      const abbr = T.zoneDisplayName(sliderT, row.zone);
      row.subEl.textContent = [
        abbr !== 'UTC' ? abbr : null,
        T.utcOffsetLabel(sliderT, row.zone),
      ].filter(Boolean).join(' ');

      // The day under the cursor keeps its label snug against the line on
      // whichever side holds more of that day (right before local noon,
      // left after — it flips at noon). A day that doesn't reach the
      // cursor keeps its label just inside its end nearest the line.
      const c = w / 2;
      for (const s of row.segs) {
        const x = s.left + shift;
        const right = x + s.width;
        if (right <= 0 || x >= w) { s.lab.style.visibility = 'hidden'; continue; }
        s.lab.style.visibility = '';
        let lx;
        if (x <= c && c < right) {
          lx = c < x + s.width / 2 ? c + LABEL_GAP_R - x : c - LABEL_GAP_L - s.labW - x;
        } else if (right <= c) {
          lx = s.width - s.labW - LABEL_INSET;
        } else {
          lx = LABEL_INSET;
        }
        lx = Math.max(4, Math.min(lx, s.width - s.labW - 4));
        s.lab.style.left = `${lx}px`;
      }
    }

    // dashed cursor on the current time; when the slider has carried it
    // off screen it parks at that edge with both labels turned inward
    const now = nowMin();
    const nx = w / 2 + (now - sliderT) * PX_PER_MS;
    nowLine.hidden = false;
    nowLine.style.left = `${Math.max(0, Math.min(nx, w))}px`;
    nowLine.classList.toggle('at-left', nx < 0);
    nowLine.classList.toggle('at-right', nx > w);
    nowTimeEl.textContent = `${T.zonedParts(now, getLocalZone()).hhmm}L`;

    nowBtn.classList.toggle('active', mode === 'now');
    takeoffBtn.classList.toggle('active', mode === 'takeoff');
  }

  function schedule() {
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(render);
    }
  }

  // The slider is always at 1-minute precision; only the readouts round.
  function setT(ms, newMode = null) {
    fling = null;
    sliderT = snapTo(ms, MINUTE);
    mode = newMode;
    if (Math.abs(sliderT - t0) > REBUILD_MS) buildSegments();
    schedule();
  }

  // Momentum after a swipe: keep the release velocity and let it decay
  // exponentially, the bars coasting to a stop on a whole minute.
  function startFling(pxPerMs) {
    fling = { v: -pxPerMs / PX_PER_MS, last: performance.now(), pos: sliderT };
    requestAnimationFrame(flingStep);
  }
  function flingStep(now) {
    if (!fling) return;
    const dt = Math.min(now - fling.last, 100);
    fling.last = now;
    fling.pos += fling.v * dt;
    fling.v *= Math.exp(-dt / FLING_TAU);
    sliderT = snapTo(fling.pos, MINUTE);
    mode = null;
    if (Math.abs(fling.v) * PX_PER_MS * 1000 < FLING_STOP_PX_S) {
      fling = null;
    } else {
      requestAnimationFrame(flingStep);
    }
    if (Math.abs(sliderT - t0) > REBUILD_MS) buildSegments();
    schedule();
  }

  let dragId = null;
  let dragStartX = 0;
  let dragStartT = 0;
  let trail = [];        // recent pointer samples for the release velocity
  stage.addEventListener('pointerdown', (e) => {
    if (sliderT === null) return;
    fling = null;
    dragId = e.pointerId;
    dragStartX = e.clientX;
    dragStartT = sliderT;
    trail = [{ t: performance.now(), x: e.clientX }];
    stage.classList.add('dragging');
    try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  });
  stage.addEventListener('pointermove', (e) => {
    if (dragId !== e.pointerId) return;
    const now = performance.now();
    trail.push({ t: now, x: e.clientX });
    while (trail.length > 2 && now - trail[0].t > VELOCITY_WINDOW) trail.shift();
    setT(dragStartT - (e.clientX - dragStartX) / PX_PER_MS);
  });
  const endDrag = (e) => {
    if (dragId !== e.pointerId) return;
    dragId = null;
    stage.classList.remove('dragging');
    const now = performance.now();
    const first = trail[0];
    const last = trail[trail.length - 1];
    const span = last.t - first.t;
    // a finger that paused before lifting releases with no velocity
    if (e.type === 'pointerup' && span >= 10 && now - last.t < 60) {
      const v = (last.x - first.x) / span;
      if (Math.abs(v) * 1000 >= FLING_MIN_PX_S) startFling(v);
    }
    trail = [];
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('wheel', (e) => {
    if (sliderT === null) return;
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    setT(sliderT + d / PX_PER_MS / 4);
  }, { passive: false });

  nowBtn.addEventListener('click', () => setT(nowMin(), 'now'));
  takeoffBtn.addEventListener('click', () => {
    const t = getTakeoffMs();
    if (t !== null) setT(t, 'takeoff');
  });
  minusBtn.addEventListener('click', () => {
    if (sliderT !== null) setT(sliderT - MINUTE);
  });
  plusBtn.addEventListener('click', () => {
    if (sliderT !== null) setT(sliderT + MINUTE);
  });

  window.addEventListener('resize', () => {
    if (sliderT === null || !rows.length) return;
    buildSegments();
    schedule();
  });

  // Once a minute (checked more often, cheap): move the dashed current-
  // time cursor and, in Now mode, the slider with it.
  let lastTick = null;
  setInterval(() => {
    if (sliderT === null || !rows.length || document.hidden || stage.offsetParent === null || fling) return;
    const now = nowMin();
    if (now === lastTick) return;
    lastTick = now;
    if (mode === 'now') setT(now, 'now');
    else schedule();
  }, 5_000);

  // Called every time the page becomes visible. A new session starts on
  // Now; a takeoff computed since the slider was last looked at re-seeds
  // it; otherwise the slider stays where it was left.
  function open() {
    fling = null;
    const takeoff = getTakeoffMs();
    if (sliderT === null) {
      sliderT = nowMin();
      mode = 'now';
      seededFrom = takeoff;
    } else if (takeoff !== null && takeoff !== seededFrom) {
      sliderT = snapTo(takeoff, MINUTE);
      mode = 'takeoff';
      seededFrom = takeoff;
    }
    takeoffBtn.disabled = takeoff === null;
    buildRows();
    buildSegments();
    render();
  }

  return { open };
}
