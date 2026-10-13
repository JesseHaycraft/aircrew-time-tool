// The templates every copy of the app carries. They can be used and
// duplicated but not edited or deleted, so the ids below are fixed for
// good: a saved choice of one of them must survive an update, and a copy
// keeps its event ids.
//
// A line is [name, offset in minutes, source]. The source names an earlier
// line of the same template; a line without one counts from takeoff.

const TEMPLATES = [
  ['mcguire-single', 'McGuire local single-ship', [
    ['Stop drink', -12 * 60],
    ['Show', -150],
    ['Brief', -120],
    ['Step', -90],
    ['Doors closed', -30],
    ['Engine start', -25],
    ['Duty day ends', 16 * 60, 'Show'],
  ]],
  ['mcguire-formation', 'McGuire local formation', [
    ['Stop drink', -12 * 60],
    ['Show', -150],
    ['Formation brief', -135],
    ['Step', -90],
    ['Doors closed', -30],
    ['Engine start', -25],
    ['Duty day ends', 16 * 60, 'Show'],
  ]],
  ['mcguire-deice', 'McGuire local de-ice', [
    ['Stop drink', -12 * 60],
    ['Show', -150],
    ['Brief', -120],
    ['Step', -105],
    ['Doors closed', -55],
    ['Engine start', -25],
    ['Duty day ends', 16 * 60, 'Show'],
  ]],
];

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function build([id, name, lines]) {
  const eventId = (lineName) => `${id}-${slug(lineName)}`;
  return {
    id,
    name,
    builtIn: true,
    takeoffCountdown: false,
    includeLanding: true,
    landingCountdown: false,
    events: lines.map(([lineName, offsetMin, from]) => ({
      id: eventId(lineName),
      name: lineName,
      source: from === undefined ? 'takeoff' : eventId(from),
      offsetMin,
      countdown: false,
    })),
  };
}

// Fresh objects on every call, so nothing done to a template in use can
// reach back into the definitions above.
export function builtInTemplates() {
  return TEMPLATES.map(build);
}
