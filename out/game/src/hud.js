// DOM HUD mirror: reads the store every frame, never simulates. Minimap,
// killfeed, banners, buy menu rows, plant/defuse channels live here.
import { BUY_LIST, WEAPONS, ARMOR_PRICE, NADE_PRICE } from './weapons.js';
import { BOMB_TICK } from './rounds.js';

const FEED_MAX = 5;
export function createHud(store, armoury) {
  const $ = (id) => document.getElementById(id);
  const el = {
    cross: $('cross'), hitm: $('hitm'),
    hpFill: $('hp-fill'), hpNum: $('hp-num'), armor: $('armor'),
    ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'), ammo: $('ammo'), money: $('money'),
    timer: $('timer'), score: $('score'), objline: $('objline'),
    feed: $('feed'), map: $('map'),
    bombbar: $('bombbar'), bombFill: $('bomb-fill'),
    chanbar: $('chanbar'), chanFill: $('chan-fill'), chanLbl: $('chan-lbl'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    vignette: $('vignette'), dmgdir: $('dmgdir'),
    start: $('start'), play: $('play'),
    buy: $('buy'), buyItems: $('buy-items'), buyMoney: $('buy-money'), buyDone: $('buy-done'),
    matchend: $('matchend'), matchCopy: $('match-copy'), again: $('again'),
  };
  const mapCtx = el.map.getContext('2d');
  const feedItems = [];
  let bannerT = 0;

  el.play.addEventListener('click', () => window.__gameStart && window.__gameStart());
  el.again.addEventListener('click', () => window.__gameRestart && window.__gameRestart());
  el.buyDone.addEventListener('click', () => window.__gameCloseBuy && window.__gameCloseBuy());

  // buy rows built once; prices/states refreshed per frame
  const rowByKind = {};
  for (const [kind, label] of BUY_LIST) {
    const row = document.createElement('div');
    row.className = 'buyrow';
    row.innerHTML = '<span class="k">' + label.split(' ')[0] + '</span>' +
      '<span class="n">' + label.slice(label.indexOf(' ') + 1) + '<small></small></span>' +
      '<span class="p"></span>';
    const small = row.querySelector('small');
    const price = row.querySelector('.p');
    if (kind === 'smg' || kind === 'awp') {
      small.textContent = WEAPONS[kind].desc;
      price.textContent = '$' + WEAPONS[kind].price;
    } else if (kind === 'armor') { small.textContent = 'Absorbs 60% of damage first.'; price.textContent = '$' + ARMOR_PRICE; }
    else { small.textContent = 'Hold G, release to throw. 95 damage.'; price.textContent = '$' + NADE_PRICE; }
    row.addEventListener('click', () => window.__gameBuy && window.__gameBuy(kind));
    el.buyItems.appendChild(row);
    rowByKind[kind] = row;
  }
  function feed(html, bad) {
    const d = document.createElement('div');
    d.innerHTML = html;
    if (bad) d.className = 'bad';
    el.feed.prepend(d);
    feedItems.push(d);
    while (feedItems.length > FEED_MAX) {
      const old = feedItems.shift();
      if (old.parentNode === el.feed) el.feed.removeChild(old);
    }
    setTimeout(() => {
      const i = feedItems.indexOf(d);
      if (i >= 0) feedItems.splice(i, 1);
      if (d.parentNode === el.feed) el.feed.removeChild(d);
    }, 5200);
  }
  function showBanner(win, title, sub, hold) {
    el.banner.className = win ? 'win' : 'lose';
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub;
    el.banner.style.display = 'block';
    bannerT = hold || 3.4;
  }
  function hideBanner() { el.banner.style.display = 'none'; }
  const mm = (t) => {
    const m = Math.max(0, Math.floor(t / 60));
    const sec = Math.max(0, Math.floor(t % 60));
    return m + ':' + String(sec).padStart(2, '0');
  };
  function drawMap(bots, bombPos) {
    const c = mapCtx, W = 170, H = 132;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#100c14';
    c.fillRect(0, 0, W, H);
    const sx = (x) => (x + 18) / 36 * W;
    const sz = (z) => (z + 13) / 26 * H;
    // sites
    c.font = 'bold 11px sans-serif';
    c.fillStyle = '#ff7a1a';
    c.fillText('A', sx(-13.5) - 4, sz(0) + 4);
    c.fillText('B', sx(13.5) - 4, sz(0) + 4);
    c.strokeStyle = '#ff7a1a88';
    c.strokeRect(sx(-15.5), sz(-2), sx(-11.5) - sx(-15.5), sz(2) - sz(-2));
    c.strokeRect(sx(11.5), sz(-2), sx(15.5) - sx(11.5), sz(2) - sz(-2));
    // player arrow
    const p = store.player;
    c.save();
    c.translate(sx(p.pos[0]), sz(p.pos[2]));
    c.rotate(-p.yaw);
    c.fillStyle = '#2dd4bf';
    c.beginPath(); c.moveTo(0, -6); c.lineTo(4, 4); c.lineTo(-4, 4); c.closePath(); c.fill();
    c.restore();
    // foes (only those recently visible: simple last-seen dots fade)
    for (const b of bots.foes) {
      if (!b.alive) continue;
      c.fillStyle = b.mode === 'FIGHT' ? '#e5484d' : '#e5484d88';
      c.beginPath(); c.arc(sx(b.pos.x), sz(b.pos.z), b.mode === 'FIGHT' ? 4 : 3, 0, 7); c.fill();
    }
    for (const b of bots.allies) {
      if (!b.alive) continue;
      c.fillStyle = b.mode === 'FIGHT' ? '#2dd4bf' : '#2dd4bf88';
      c.beginPath(); c.arc(sx(b.pos.x), sz(b.pos.z), 3, 0, 7); c.fill();
    }
    if (bombPos) {
      c.fillStyle = '#ff2200';
      c.beginPath(); c.arc(sx(bombPos[0]), sz(bombPos[2]), 4, 0, 7); c.fill();
    }
  }
  let lastHp = -1, lastArmor = -1, lastMag = -1, lastRes = -1, lastSlot = '';
  return {
    feed, showBanner, hideBanner,
    setBuyOpen(open, round) {
      el.buy.hidden = !open;
      if (open) el.buyMoney.textContent = '$' + store.money + ' · round ' + round;
    },
    refreshBuy() {
      el.buyMoney.textContent = '$' + store.money + ' · round ' + store.round;
      for (const [kind] of BUY_LIST) {
        const row = rowByKind[kind];
        const owned = kind === 'smg' || kind === 'awp' ? armoury.owned[kind] : false;
        row.classList.toggle('owned', !!owned);
      }
    },
    hit(kill) {
      el.hitm.classList.add('on');
      el.hitm.classList.toggle('kill', !!kill);
      clearTimeout(el.hitm._t);
      el.hitm._t = setTimeout(() => { el.hitm.classList.remove('on'); el.hitm.classList.remove('kill'); }, kill ? 220 : 110);
    },
    damageFlash(dirYaw) {
      el.vignette.style.opacity = '0.85';
      clearTimeout(el.vignette._t);
      el.vignette._t = setTimeout(() => { el.vignette.style.opacity = '0'; }, 260);
      if (dirYaw !== undefined) {
        el.dmgdir.style.opacity = '1';
        el.dmgdir.style.transform = 'rotate(' + dirYaw + 'rad)';
        clearTimeout(el.dmgdir._t);
        el.dmgdir._t = setTimeout(() => { el.dmgdir.style.opacity = '0'; }, 700);
      }
    },
    frame(bots, spreadPx) {
      const p = store.player;
      if (p.hp !== lastHp || p.armor !== lastArmor) {
        lastHp = p.hp; lastArmor = p.armor;
        el.hpNum.textContent = String(Math.max(0, Math.ceil(p.hp)));
        el.hpFill.style.width = Math.max(0, Math.min(100, p.hp)) + '%';
        el.armor.textContent = '⛨ ' + Math.round(p.armor);
      }
      const a = armoury.ammo[armoury.state.slot];
      if (a.mag !== lastMag || a.reserve !== lastRes || armoury.state.slot !== lastSlot) {
        lastMag = a.mag; lastRes = a.reserve; lastSlot = armoury.state.slot;
        el.ammoMag.textContent = String(a.mag);
        el.ammoRes.textContent = '/ ' + a.reserve + ' · ' + armoury.spec().name;
        el.ammo.classList.toggle('empty', a.mag === 0);
      }
      if (el.money.textContent !== '$' + store.money) el.money.textContent = '$' + store.money;
      el.timer.textContent = mm(store.timer);
      el.timer.classList.toggle('low', store.timer < 10 && store.phase === 'live');
      const sc = store.wins[0] + ' — ' + store.wins[1] + ' · R' + store.round;
      if (el.score.innerHTML !== sc) el.score.innerHTML = '<b>' + store.wins[0] + '</b> — ' + store.wins[1] + ' · R' + store.round;
      el.objline.textContent = store.bomb.state === 'ticking'
        ? 'DEFUSE THE CHARGE at site ' + store.bomb.site + ' [E]'
        : store.phase === 'buy' ? 'Buy up — round ' + store.round + ' starts soon'
        : 'Defend vaults A and B · first to 5';
      el.cross.style.setProperty('--gap', (5 + (spreadPx || 0) * 260) + 'px');
      // channels
      if (store.bomb.state === 'ticking') {
        el.bombbar.style.display = 'block';
        el.bombFill.style.width = Math.min(100, store.bomb.tickT / BOMB_TICK * 100) + '%';
      } else el.bombbar.style.display = 'none';
      if (store.defuse.active) {
        el.chanbar.style.display = 'block';
        el.chanLbl.textContent = 'DEFUSING…';
        el.chanFill.style.width = (store.defuse.t / store.defuse.need * 100) + '%';
      } else if (store.plant.active) {
        el.chanbar.style.display = 'block';
        el.chanLbl.textContent = 'PLANTING…';
        el.chanFill.style.width = (store.plant.t / store.plant.need * 100) + '%';
      } else el.chanbar.style.display = 'none';
      if (bannerT > 0) { bannerT -= 1 / 60; if (bannerT <= 0) hideBanner(); }
      drawMap(bots, store.bomb.state === 'ticking' ? store.bomb.pos : null);
    },
  };
}
