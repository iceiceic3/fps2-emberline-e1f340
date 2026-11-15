// The one state store: every mutable game fact lives in `createStore()` and
// nothing else holds a copy. Systems read it, fixed-step logic writes it,
// the renderer only mirrors it.
export const PHASE = { BUY: 'buy', LIVE: 'live', END: 'end', OVER: 'over' };
export const TEAM = { YOU: 0, FOE: 1 };
export function createStore() {
  return {
    phase: PHASE.BUY,
    round: 1,
    wins: [0, 0],
    money: 800,
    timer: 20,
    buyOpen: true,
    bomb: { state: 'idle', site: null, plantT: 0, tickT: 0, pos: null },
    defuse: { active: false, t: 0, need: 5 },
    plant: { active: false, t: 0, need: 3 },
    player: {
      hp: 100, armor: 0, alive: true, crouching: false,
      pos: [0, 0, 10], vel: [0, 0, 0], yaw: 0, pitch: 0, eye: 1.6,
      onGround: true, flash: 0,
    },
    kills: 0, deaths: 0, plantedByFoe: false,
    banner: null,
  };
}
