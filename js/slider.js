// Slider page: stacked per-zone day bars dragged under a fixed center
// line. The line is the selected instant; bars carry local-day segments
// whose widths come from real midnight boundaries (23/25 h across DST).
import * as T from './time-engine.js?v=0.3.1';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const PX_PER_HOUR = 48;              // ≈8 hours visible on a phone screen
const PX_PER_MS = PX_PER_HOUR / HOUR;
const COVER_MS = 20 * HOUR;          // segments are built for t0 ± this
const REBUILD_MS = 10 * HOUR;        // rebuild when the drag strays this far

export function initSlider({
  stage, rowsEl, nowBtn, takeoffBtn, minusBtn, plusBtn,
  getLocalZone, getExtraZones, getTakeoffMs,
}) {
  let sliderT = null;    // selected instant (ms epoch, minute-snapped)
  let seededFrom = null; // takeoff value the slider last seeded itself from
  let t0 = null;         // reference instant the strips were built around
  let rows = [];
  let rafPending = false;

  const snap = (ms) => Math.round(ms / MINUTE) * MINUTE;

  function rowDefs() {
    return [
      { zone: 'UTC', name: 'Zulu', suffix: 'Z' },
      { zone: getLocalZone(), name: null, suffix: 'L' },
      ...getExtraZones().map((zone) => ({ zone, name: null, suffix: '' })),
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
      nameEl.textContent = def.name ?? T.zoneLabel(def.zone);
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
      for (const seg of T.daySegments(row.zone, t0 - COVER_MS, t0 + COVER_MS)) {
        const el = document.createElement('div');
        // day-number parity alternates the two tones (month rollovers may
        // repeat a tone once; the borders still separate the days)
        el.className = `sl-seg ${Number(seg.day) % 2 ? 'day-a' : 'day-b'}`;
        const left = (seg.start - t0) * PX_PER_MS + w / 2;
        const width = (seg.end - seg.start) * PX_PER_MS;
        el.style.left = `${left}px`;
        el.style.width = `${width}px`;
        // weekday and date as separate spans with a center gap, so the
        // cursor line passes between them when the label sits mid-screen
        const lab = document.createElement('span');
        lab.className = 'sl-seg-label';
        const wd = document.createElement('span');
        wd.textContent = seg.weekday;
        const dm = document.createElement('span');
        dm.textContent = `${Number(seg.day)} ${seg.month}`;
        lab.append(wd, dm);
        el.append(lab);
        row.strip.append(el);
        row.segs.push({ lab, left, width, labW: 0 });
      }
      for (const s of row.segs) s.labW = s.lab.offsetWidth;
    }
  }

  function render() {
    rafPending = false;
    const w = stage.clientWidth;
    const shift = (t0 - sliderT) * PX_PER_MS;
    for (const row of rows) {
      row.strip.style.transform = `translateX(${shift}px)`;

      const p = T.zonedParts(sliderT, row.zone);
      row.timeEl.textContent = `${p.hhmm}${row.suffix}`;
      const name = row.name ?? T.zoneLabel(row.zone);
      const abbr = T.zoneDisplayName(sliderT, row.zone);
      row.subEl.textContent = [
        abbr !== name && abbr !== 'UTC' ? abbr : null,
        T.utcOffsetLabel(sliderT, row.zone),
      ].filter(Boolean).join(' ');

      // keep each day label inside the visible part of its segment
      for (const s of row.segs) {
        const x = s.left + shift;
        const visL = Math.max(x, 0);
        const visR = Math.min(x + s.width, w);
        if (visR <= visL) { s.lab.style.visibility = 'hidden'; continue; }
        s.lab.style.visibility = '';
        let lx = (visL + visR) / 2 - s.labW / 2 - x;
        lx = Math.max(4, Math.min(lx, s.width - s.labW - 4));
        s.lab.style.left = `${lx}px`;
      }
    }
  }

  function schedule() {
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(render);
    }
  }

  function setT(ms) {
    sliderT = snap(ms);
    if (Math.abs(sliderT - t0) > REBUILD_MS) buildSegments();
    schedule();
  }

  let dragId = null;
  let dragStartX = 0;
  let dragStartT = 0;
  stage.addEventListener('pointerdown', (e) => {
    if (sliderT === null) return;
    dragId = e.pointerId;
    dragStartX = e.clientX;
    dragStartT = sliderT;
    stage.classList.add('dragging');
    try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  });
  stage.addEventListener('pointermove', (e) => {
    if (dragId !== e.pointerId) return;
    setT(dragStartT - (e.clientX - dragStartX) / PX_PER_MS);
  });
  const endDrag = (e) => {
    if (dragId !== e.pointerId) return;
    dragId = null;
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('wheel', (e) => {
    if (sliderT === null) return;
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    setT(sliderT + d / PX_PER_MS / 4);
  }, { passive: false });

  nowBtn.addEventListener('click', () => setT(Date.now()));
  takeoffBtn.addEventListener('click', () => {
    const t = getTakeoffMs();
    if (t !== null) setT(t);
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

  // Called every time the page becomes visible. Re-seeds to the takeoff
  // when a new one has been computed since the last look; otherwise the
  // slider stays where it was left.
  function open() {
    const takeoff = getTakeoffMs();
    if (takeoff !== null && takeoff !== seededFrom) {
      sliderT = snap(takeoff);
      seededFrom = takeoff;
    } else if (sliderT === null) {
      sliderT = snap(Date.now());
    }
    takeoffBtn.disabled = getTakeoffMs() === null;
    buildRows();
    buildSegments();
    render();
  }

  return { open };
}
