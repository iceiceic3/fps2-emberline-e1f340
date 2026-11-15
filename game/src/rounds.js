// Round director: buy phase -> live round -> end banner -> next round.
// Owns the timer, the plant/defuse channels, the money awards and win checks.
import { PHASE } from './store.js';

export const ROUND_TIME = 75;
export const BUY_TIME = 20;
export const BOMB_TICK = 35;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;
const START_MONEY = 800;

const AWARDS = { kill: 300, win: 3250, loss: 1900, plant: 300 };

export function createRounds(store, bots, armoury, fx) {
  const s = store;
  function startBuy(first) {
    s.phase = PHASE.BUY;
    s.timer = BUY_TIME;
    s.buyOpen = true;
    s.bomb = { state: 'idle', site: null, plantT: 0, tickT: 0, pos: null };
    s.defuse = { active: false, t: 0, need: 5 };
    s.plant = { active: false, t: 0, need: 3 };
    s.plantedByFoe = false;
    s.player.hp = 100;
    s.player.alive = true;
    s.player.pos = [0, 0, 10];
    s.player.vel = [0, 0, 0];
    s.player.yaw = 0; s.player.pitch = 0;
    s.player.armor = first ? 0 : s.player.armor;
    if (first) s.money = START_MONEY;
    armoury.refillRound();
    bots.spawnRound(s.round);
    fx.onBuy(s);
  }
  function startLive() {
    s.phase = PHASE.LIVE;
    s.buyOpen = false;
    s.timer = ROUND_TIME;
    fx.onLive(s);
  }
  function endRound(winner, reason) {
    if (s.phase !== PHASE.LIVE) return;
    s.phase = PHASE.END;
    s.timer = 4.5;
    s.buyOpen = false;
    s.plant.active = false;
    s.defuse.active = false;
    s.wins[winner]++;
    if (winner === 0) {
      s.money += AWARDS.win + (s.killsThisRound || 0) * AWARDS.kill;
      s.banner = { win: true, title: 'ROUND HELD', sub: reason };
      fx.audio.round(true);
    } else {
      s.money += AWARDS.loss;
      s.banner = { win: false, title: 'SITE LOST', sub: reason };
      fx.audio.round(false);
    }
    s.money = Math.min(16000, s.money);
    s.killsThisRound = 0;
    fx.onRoundEnd(s, winner, reason);
  }
  function checkWin() {
    if (s.phase !== PHASE.LIVE) return;
    const foes = bots.aliveCount();
    if (foes === 0 && s.bomb.state !== 'ticking') {
      s.player.alive = true; // sentinel line held the vault: you stand back up
      endRound(0, 'All raiders eliminated.');
      return;
    }
    if (!s.player.alive) {
      if (s.bomb.state === 'ticking') return; // dead but ticking: allies can defuse
      if (bots.allyCount() > 0) return; // sentinels still hold: stay down
      endRound(1, 'You were eliminated.');
      return;
    }
    if (foes === 0) {
      if (s.bomb.state === 'ticking') { bots.comms.plant = null; endRound(0, 'Charge defused — site clear.'); s.bomb.state = 'idle'; }
      else endRound(0, 'All raiders eliminated.');
    }
  }
  function step(dt) {
    if (s.phase === PHASE.BUY) {
      s.timer -= dt;
      if (s.timer <= 0) startLive();
    } else if (s.phase === PHASE.LIVE) {
      s.timer -= dt;
      // foe hard-plant fallback: if a foe reaches a site uncontested late, it plants
      if (s.bomb.state === 'idle') {
        for (const b of bots.foes) {
          if (!b.alive || (b.mode !== 'HOLD' && b.mode !== 'EXECUTE')) continue;
          b.plantT = (b.plantT || 0) + dt * (s.player.alive ? 0.12 : 1);
          if (b.plantT > 14) {
            s.bomb.state = 'ticking';
            s.bomb.site = b.site;
            s.bomb.pos = [b.pos.x, 0.35, b.pos.z];
            s.plantedByFoe = true;
            bots.comms.plant = { site: s.bomb.site, x: s.bomb.pos[0], z: s.bomb.pos[2] };
            fx.onPlant(s, false);
            break;
          }
        }
      }
      if (s.bomb.state === 'ticking') {
        s.bomb.tickT += dt;
        if (s.bomb.tickT >= BOMB_TICK) { bots.comms.plant = null;
          fx.onBoom(s);
          endRound(1, 'The charge detonated.');
          return;
        }
      }
      if (s.timer <= 0 && s.bomb.state !== 'ticking') {
        endRound(s.player.alive ? 0 : 1, 'Time expired — vaults held.');
      }
    } else if (s.phase === PHASE.END) {
      s.timer -= dt;
      if (s.timer <= 0) {
        if (s.wins[0] >= WIN_ROUNDS || s.wins[1] >= WIN_ROUNDS || s.round >= MAX_ROUNDS) {
          s.phase = PHASE.OVER;
          fx.onMatchEnd(s);
        } else {
          s.round++;
          startBuy(false);
        }
      }
    }
  }
  return {
    startBuy, startLive, endRound, checkWin, step,
    awardKill() {
      s.money += AWARDS.kill;
      s.killsThisRound = (s.killsThisRound || 0) + 1;
    },
    awardPlant() { s.money += AWARDS.plant; },
  };
}
