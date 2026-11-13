// Presentation only: while someone's model call is running they do not just sit there. Every so often
// they walk to the place that belongs to their post (the whiteboard, the server racks, the test bench…),
// spend a moment, and come back. It shows who does what; it never claims what the model is doing.
export function createRoutines({ employees, station, walk, home, say, emote, random = Math.random }) {
  const routines = new Map();
  const pause = () => 14 + random() * 14;
  const pick = list => list[Math.floor(random() * list.length) % list.length];
  const stop = (e, r) => { r.phase = null; r.place = null; e.errand = null; e.atStation = null; };

  function step(dt) {
    for (const e of employees()) {
      let r = routines.get(e.id);
      if (!r) routines.set(e.id, r = { next: 5 + random() * 8, phase: null, place: null, t: 0 });
      const working = !!e.writing && !e.writing.talk && !e.meeting && !e.waiting;
      if (!working) { if (r.phase) stop(e, r); continue; }
      if (e.held) continue;
      if (!r.phase) {
        // only from the desk: someone still on the way there, or busy with a colleague, is left alone
        if (e.path.length || e.social || e.spot !== home(e)) continue;
        r.next -= dt;
        if (r.next > 0) continue;
        r.next = pause();
        const place = station(e);
        if (!place) continue;
        r.phase = 'out'; r.place = place; e.errand = place.name; walk(e, place);
      } else if (r.phase === 'out') {
        if (e.path.length) continue;
        r.phase = 'there'; r.t = 3.2; e.atStation = r.place.post || true;
        say(e, pick(r.place.doing), 'tool'); emote(e, r.place.emote);
      } else if (r.phase === 'there') {
        r.t -= dt;
        if (r.t > 0) continue;
        r.phase = 'back'; e.atStation = null; walk(e, home(e));
      } else if (!e.path.length) stop(e, r);
    }
  }
  return { step };
}
