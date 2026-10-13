// The templates every copy of the app carries. They can be used and
// duplicated but not edited or deleted, so the ids below are fixed for
// good: a saved choice of one of them must survive an update, and a copy
// keeps its event ids.
//
// A line is [name, offset in minutes, options]. In the options, `from`
// names an earlier line of the same template the offset counts from (a
// line without one counts from takeoff), `countdown` turns on the live
// countdown to the event and `copy` ticks it when the times are copied
// (only crew rest, show and takeoff are, unless the user says otherwise).

const TEMPLATES = [
  ['mcguire-single', 'McGuire local single-ship', [
    ['Enter crew rest', -12 * 60, { from: 'Show', countdown: true, copy: true }],
    ['Stop drink', -12 * 60],
    ['Show', -150, { copy: true }],
    ['Brief', -120],
    ['Step', -90],
    ['Doors closed', -30],
    ['Engine start', -25],
    ['Duty day ends', 16 * 60, { from: 'Show' }],
  ]],
  ['mcguire-formation', 'McGuire local formation', [
    ['Enter crew rest', -12 * 60, { from: 'Show', countdown: true, copy: true }],
    ['Stop drink', -12 * 60],
    ['Show', -150, { copy: true }],
    ['Formation brief', -135],
    ['Step', -90],
    ['Doors closed', -30],
    ['Engine start', -25],
    ['Duty day ends', 16 * 60, { from: 'Show' }],
  ]],
  ['mcguire-deice', 'McGuire local de-ice', [
    ['Enter crew rest', -12 * 60, { from: 'Show', countdown: true, copy: true }],
    ['Stop drink', -12 * 60],
    ['MX de-ice start', -5 * 60],
    ['MX de-ice complete', -3 * 60],
    ['Show', -150, { copy: true }],
    ['Brief', -120],
    ['Step', -105],
    ['Doors closed', -55],
    ['Anti-ice start', -55],
    ['Anti-ice complete', -25],
    ['Engine start', -25],
    ['Duty day ends', 16 * 60, { from: 'Show' }],
  ]],
];

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function build([id, name, lines]) {
  const eventId = (lineName) => `${id}-${slug(lineName)}`;
  return {
    id,
    name,
    builtIn: true,
    takeoffCountdown: true,
    includeLanding: true,
    landingCountdown: false,
    takeoffCopy: true,
    landingCopy: false,
    events: lines.map(([lineName, offsetMin, { from, countdown = false, copy = false } = {}]) => ({
      id: eventId(lineName),
      name: lineName,
      source: from === undefined ? 'takeoff' : eventId(from),
      offsetMin,
      countdown,
      copy,
    })),
  };
}

// Fresh objects on every call, so nothing done to a template in use can
// reach back into the definitions above.
export function builtInTemplates() {
  return TEMPLATES.map(build);
}
