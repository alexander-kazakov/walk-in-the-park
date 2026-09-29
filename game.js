'use strict';
(() => {
  // ============================================================ utils
  const $ = (s) => document.querySelector(s);
  const canvas = $('#game');
  const ctx = canvas.getContext('2d');
  const W = 2000, H = 1400, TAU = Math.PI * 2;

  let seed = 20260929; // deterministic park layout
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rand = (a, b) => a + rnd() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
    const t = l ? clamp(((px - x1) * dx + (py - y1) * dy) / l, 0, 1) : 0;
    return dist(px, py, x1 + t * dx, y1 + t * dy);
  }

  // ============================================================ audio
  let actx = null, muted = false;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone({ type = 'sine', f = 440, f2 = 0, dur = 0.15, vol = 0.12, delay = 0 }) {
    const a = audio(); if (!a || muted) return;
    const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur = 0.3, vol = 0.12, freq = 900) {
    const a = audio(); if (!a || muted) return;
    const n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = buf; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
    s.connect(f).connect(g).connect(a.destination); s.start();
  }
  const sfx = {
    quack() { tone({ type: 'sawtooth', f: 560, f2: 260, dur: 0.18, vol: 0.1 }); tone({ type: 'square', f: 500, f2: 240, dur: 0.12, vol: 0.04, delay: 0.03 }); },
    woof(v = 1) { tone({ type: 'square', f: 190, f2: 110, dur: 0.13, vol: 0.09 * v }); tone({ type: 'square', f: 170, f2: 100, dur: 0.12, vol: 0.07 * v, delay: 0.17 }); },
    pick() { tone({ type: 'triangle', f: 660, f2: 990, dur: 0.1, vol: 0.1 }); },
    done() { [523, 659, 784, 1046].forEach((f, i) => tone({ type: 'triangle', f, dur: 0.18, vol: 0.1, delay: i * 0.09 })); },
    fire() { noise(0.3, 0.14, 1400); },
    ice() { tone({ type: 'sine', f: 1800, f2: 2600, dur: 0.18, vol: 0.05 }); tone({ type: 'sine', f: 2400, f2: 1500, dur: 0.22, vol: 0.035, delay: 0.05 }); },
    bonk() { tone({ type: 'square', f: 240, f2: 90, dur: 0.08, vol: 0.08 }); },
    bad() { tone({ type: 'sawtooth', f: 200, f2: 110, dur: 0.25, vol: 0.09 }); },
    talk() { tone({ type: 'triangle', f: 420 + Math.random() * 140, dur: 0.05, vol: 0.05 }); },
    click() { tone({ type: 'square', f: 880, dur: 0.05, vol: 0.05 }); tone({ type: 'square', f: 1320, dur: 0.05, vol: 0.05, delay: 0.06 }); },
    whistle() { tone({ type: 'sine', f: 2200, f2: 2600, dur: 0.25, vol: 0.09 }); tone({ type: 'sine', f: 2200, f2: 2700, dur: 0.4, vol: 0.09, delay: 0.3 }); },
    splash() { noise(0.4, 0.12, 600); },
  };

  // ============================================================ world
  const WALK_GOAL = 2400, GARBAGE_GOAL = 8, FLOWER_GOAL = 5, QUACK_GOAL = 12;
  const SPAWN = { x: 1000, y: 1320 };
  const pond = { x: 1430, y: 420, rx: 230, ry: 150 };
  const shed = { x: 170, y: 170, w: 170, h: 120 };
  const booth = { x: 440, y: 900, w: 150, h: 70 };
  const rects = [shed, booth];
  const paths = [
    [1000, 1400, 1000, 700], [140, 700, 1860, 700], [1000, 700, 1000, 150],
    [255, 290, 255, 700], [1000, 420, 1150, 420], [515, 700, 515, 900],
    [1000, 1180, 760, 1180], [1000, 1050, 1600, 1050],
  ];
  const benches = [{ x: 800, y: 1146 }, { x: 1560, y: 1016 }, { x: 1080, y: 560 }];
  const bins = [{ x: 1040, y: 760, r: 12 }, { x: 560, y: 660, r: 12 }, { x: 1300, y: 1090, r: 12 }];

  const mkPerson = (o) => Object.assign({ frozen: 0, bubble: null, jump: 0, fx: 0, fy: 1 }, o);
  const grandma = mkPerson({ x: 800, y: 1150, name: 'Grandma Rosa', shirt: '#b58bd1', hair: '#e8e8e8', sitting: true });
  const keeper = mkPerson({ x: 380, y: 320, name: 'Keeper Pim', shirt: '#3f7d3a', hair: '#6b4423', hat: '#5a8f3a' });
  const sam = mkPerson({ x: 1560, y: 1020, name: 'Sam', shirt: '#e0873a', hair: '#2b1b0e', sitting: true, friend: false });
  const officer = mkPerson({
    x: 1000, y: 900, name: 'Officer Bramble', shirt: '#2f4f8f', hair: '#3a2a1a', hat: '#1d2f5c', cop: true,
    mode: 'patrol', wp: 0, chaseT: 0, charge: '', cool: 0,
  });
  const route = [[1000, 1250], [1000, 700], [520, 700], [255, 700], [255, 430], [255, 700], [1000, 700], [1000, 260], [1000, 700], [1750, 700], [1000, 700], [1000, 1050], [1550, 1050], [1000, 1050]];
  const people = [grandma, keeper, sam, officer];

  const player = { x: SPAWN.x, y: SPAWN.y, r: 12, fx: 0, fy: -1, walk: 0, speed: 190, wasWater: false };
  const dog = { x: 840, y: 1175, state: 'grandma', hideBush: null, frozen: 0, bark: 2, spin: 0, wag: 0 };
  const squirrel = { active: false, x: 0, y: 0, phase: '', tree: null };

  const trees = [], bushes = [], garbage = [], flowers = [], iceP = [], ducks = [];
  const particles = [], floats = [];

  function inPond(x, y, pad = 0) { return ((x - pond.x) / (pond.rx + pad)) ** 2 + ((y - pond.y) / (pond.ry + pad)) ** 2 < 1; }
  function onIce(x, y) { return iceP.some((p) => dist(x, y, p.x, p.y) < p.r); }
  function inWater(x, y) { return inPond(x, y) && !onIce(x, y); }
  function circleRect(x, y, r, R) {
    const cx = clamp(x, R.x, R.x + R.w), cy = clamp(y, R.y, R.y + R.h);
    return dist(x, y, cx, cy) < r;
  }

  function spotFree(x, y, r, placed, { onPath = false } = {}) {
    if (x < 60 || y < 60 || x > W - 60 || y > H - 60) return false;
    if (!onPath) for (const p of paths) if (segDist(x, y, ...p) < 26 + r) return false;
    if (inPond(x, y, onPath ? 20 : 90)) return false;
    for (const R of rects) if (circleRect(x, y, r + 30, R)) return false;
    for (const p of people) if (dist(x, y, p.x, p.y) < 70 + r) return false;
    for (const b of benches) if (dist(x, y, b.x, b.y) < 60 + r) return false;
    if (dist(x, y, SPAWN.x, SPAWN.y) < 90) return false;
    for (const o of placed) if (dist(x, y, o.x, o.y) < o.r + r + 14) return false;
    return true;
  }
  function place(n, r, extra, opts) {
    const out = [];
    let guard = 0;
    while (out.length < n && guard++ < 5000) {
      const x = rand(60, W - 60), y = rand(60, H - 60);
      if (spotFree(x, y, r, allPlaced(), opts)) { const o = Object.assign({ x, y, r }, extra()); out.push(o); placedAll.push(o); }
    }
    return out;
  }
  const placedAll = [];
  const allPlaced = () => placedAll;

  function buildWorld() {
    trees.push(...place(46, 18, () => ({ burnt: false, frozen: 0, s: rand(0.85, 1.25), hue: rand(-12, 12) })));
    bushes.push(...place(13, 20, () => ({ burnt: 0, frozen: 0, shake: 0 })));
    const types = ['can', 'bottle', 'paper', 'bag', 'can', 'paper'];
    garbage.push(...place(14, 8, () => ({ type: types[Math.floor(rnd() * types.length)], taken: false, frozen: 0, rot: rand(0, TAU) }), { onPath: true }));
    const colors = ['#ff6fa8', '#ffd23f', '#b98cff', '#ff7a4d', '#6fc3ff', '#ffffff'];
    flowers.push(...place(9, 8, () => ({ color: colors[Math.floor(rnd() * colors.length)], picked: false, burnt: 0, frozen: 0 })));
    for (let i = 0; i < 3; i++) ducks.push({ a: rand(0, TAU), rr: rand(0.3, 0.75), sp: rand(0.1, 0.25) * (rnd() < 0.5 ? -1 : 1), frozen: 0, fly: 0, gone: 0, x: 0, y: 0 });
  }

  // ============================================================ state & quests
  const state = {
    screen: 'title', time: 0, mode: 'normal', hasPicker: false, hasSwitch: false,
    usedIce: false, usedFire: false, garbage: 0, bag: 0, flowers: 0, flowersFound: 0,
    walkDist: 0, cool: 0, sfxT: 0, quackBest: 0, arrests: 0, burntTrees: 0, won: false,
    jailT: 0, noPickerWarned: 0,
  };
  const quests = [
    { id: 'walk', title: "Walk Grandma's dog" },
    { id: 'lose', title: 'Lose the dog' },
    { id: 'find', title: 'Find the dog' },
    { id: 'garbage', title: 'Pick the garbage with a picker' },
    { id: 'friend', title: 'Make a friend' },
    { id: 'flowers', title: 'Find some flowers' },
    { id: 'upgrade', title: 'Upgrade your picker: ❄️ ice / 🔥 fire switch' },
    { id: 'quack', title: 'Quack-a-mole' },
    { id: 'arrest', title: 'Get arrested for littering', bonus: true },
  ];
  const Q = Object.fromEntries(quests.map((q) => [q.id, Object.assign(q, { done: false })]));

  function questHint(id) {
    switch (id) {
      case 'walk':
        if (Q.walk.done) return 'Biscuit got his exercise. And then some.';
        if (dog.state === 'leashed') return `Walking Biscuit… ${Math.floor((100 * state.walkDist) / WALK_GOAL)}%`;
        return 'Grandma Rosa is on the bench south-west of the crossroads.';
      case 'lose':
        if (Q.lose.done) return 'Oops.';
        return Q.walk.done ? 'In progress… (this one tends to happen on its own)' : 'Surely this won\'t happen by accident.';
      case 'find':
        if (Q.find.done) return 'Biscuit is back with Grandma.';
        if (dog.state === 'hidden') return 'Listen for "woof!" and search the bushes (E).';
        if (dog.state === 'found') return 'Bring Biscuit back to Grandma Rosa.';
        return 'You\'d have to lose him first.';
      case 'garbage':
        if (Q.garbage.done) return `${state.garbage} pieces collected. Keeper Pim will be thrilled.`;
        return state.hasPicker ? `${state.garbage}/${GARBAGE_GOAL} — walk up to litter and press E or Space` : 'Get a picker from Keeper Pim by the shed (north-west).';
      case 'friend':
        return Q.friend.done ? 'Sam tags along everywhere now.' : 'Sam looks lonely on the east bench.';
      case 'flowers':
        return Q.flowers.done ? `${state.flowersFound} found · ${state.flowers} in your pocket` : `${state.flowersFound}/${FLOWER_GOAL} — look away from the paths`;
      case 'upgrade':
        if (Q.upgrade.done) return `Fire and ice mastered. Trees burnt: ${state.burntTrees}.`;
        if (!state.hasSwitch) return Q.garbage.done ? 'Show Keeper Pim your cleaning work.' : 'Clean up first — Keeper Pim has something special.';
        return `Q to switch, Space to use. Ice ${state.usedIce ? '✓' : '✗'} · Fire ${state.usedFire ? '✓' : '✗'}`;
      case 'quack':
        return Q.quack.done ? `Best score: ${state.quackBest}` : `Score ${QUACK_GOAL}+ at the booth on the west path (best: ${state.quackBest}).`;
      case 'arrest':
        return Q.arrest.done ? `Arrests: ${state.arrests}. Your mother would be so proud.` : 'Officer Bramble patrols the paths. Press L to litter… if you dare.';
    }
    return '';
  }

  const questList = $('#questList');
  let lastQuestHTML = '';
  function renderQuests() {
    const html = quests.map((q) =>
      `<li class="${q.done ? 'done' : ''} ${q.bonus ? 'bonus' : ''}"><span class="box">${q.done ? '✓' : ''}</span>` +
      `<span class="title">${q.title}</span><span class="hint">${questHint(q.id)}</span></li>`).join('');
    if (html !== lastQuestHTML) { questList.innerHTML = html; lastQuestHTML = html; }
    const main = quests.filter((q) => !q.bonus);
    $('#questCount').textContent = `${main.filter((q) => q.done).length}/${main.length}`;
    const m = $('#mode');
    if (!state.hasPicker) m.textContent = '🦯 No picker yet';
    else if (!state.hasSwitch) m.textContent = '🦯 Picker';
    else m.textContent = state.mode === 'normal' ? '🦯 Picker: normal (Q)' : state.mode === 'ice' ? '❄️ Picker: ICE (Q)' : '🔥 Picker: FIRE (Q)';
    m.className = 'pill ' + state.mode;
    $('#bag').textContent = `🗑️ Bag: ${state.bag}` + (state.flowers ? ` · 🌸 ${state.flowers}` : '');
  }

  function complete(id, msg) {
    const q = Q[id]; if (q.done) return;
    q.done = true; sfx.done();
    toast(`✅ <b>${q.title}</b>${msg ? '<br>' + msg : ''}`, 'good');
    renderQuests();
    if (!state.won && quests.filter((x) => !x.bonus).every((x) => x.done)) { state.won = true; setTimeout(showWin, 1800); }
  }

  // ============================================================ UI: toasts, dialog, floats
  const toastBox = $('#toasts');
  function toast(html, cls = '') {
    const d = document.createElement('div'); d.className = 'toast ' + cls; d.innerHTML = html;
    toastBox.appendChild(d);
    while (toastBox.children.length > 4) toastBox.firstChild.remove();
    setTimeout(() => d.classList.add('out'), 3600);
    setTimeout(() => d.remove(), 4100);
  }
  function float(x, y, text, color = '#fff', size = 16) { floats.push({ x, y, text, color, size, life: 1.4 }); }
  function shout(p, text, t = 2.2) { p.bubble = { text, t }; }

  const dlg = $('#dialog');
  let dialogOpen = false, dialogChoices = [];
  function say(name, text, choices) {
    choices = choices && choices.length ? choices : [{ label: 'OK' }];
    dialogOpen = true; dialogChoices = choices;
    dlg.hidden = false;
    dlg.querySelector('.name').textContent = name;
    dlg.querySelector('.text').textContent = text;
    const box = dlg.querySelector('.choices'); box.innerHTML = '';
    choices.forEach((c, i) => {
      const b = document.createElement('button');
      b.textContent = (choices.length > 1 ? `${i + 1}. ` : '') + c.label;
      b.onclick = () => choose(i);
      box.appendChild(b);
    });
    sfx.talk();
  }
  function choose(i) {
    const c = dialogChoices[i]; if (!c) return;
    dialogOpen = false; dlg.hidden = true;
    if (c.fn) c.fn();
  }

  // ============================================================ NPC conversations
  function talkGrandma() {
    if (grandma.frozen > 0) return toast('Grandma Rosa is currently a popsicle. Give it a second.');
    switch (dog.state) {
      case 'grandma':
        return say('Grandma Rosa', "Oh hello, dear! My knees aren't what they used to be. Would you take Biscuit for a walk? He adores the pond loop.", [
          { label: 'Sure! 🐕', fn: () => { dog.state = 'leashed'; toast('🐕 Biscuit is on the leash. Walk him around the park!'); sfx.woof(); renderQuests(); } },
          { label: 'Maybe later' },
        ]);
      case 'leashed':
        return say('Grandma Rosa', `Is he behaving? Walk him a little more, dear — he needs his exercise. (${Math.floor((100 * state.walkDist) / WALK_GOAL)}%)`);
      case 'chase': case 'hidden':
        return say('Grandma Rosa', "BISCUIT?! Where is my Biscuit?! He loves hiding in bushes, dear. Listen for his bark!");
      case 'found':
        return returnDog();
      default: {
        const lines = ['Thank you, dear. Biscuit and I will sit here and judge the pigeons.',
          'You young people with your fire-breathing garbage sticks. In my day we picked litter with our hands. Uphill.'];
        if (state.burntTrees > 0) lines.push(`Do you smell smoke, dear? I count ${state.burntTrees} fewer trees than this morning.`);
        if (state.arrests > 0) lines.push("I saw Officer Bramble carry you off. I've been arrested three times myself. Don't tell Biscuit.");
        return say('Grandma Rosa', pick(lines));
      }
    }
  }
  function returnDog() {
    dog.state = 'home';
    complete('find', 'Biscuit is home safe (and only slightly singed).');
    say('Grandma Rosa', "Biscuit! Oh, you found him! You naughty boy. Thank you, dear — here, have a butterscotch. It's older than you.");
  }

  function talkKeeper() {
    if (keeper.frozen > 0) return toast('Keeper Pim is frozen solid. Rude.');
    if (!state.hasPicker) {
      return say('Keeper Pim', `Ah, a volunteer! This park's a mess. Take this litter picker — grab ${GARBAGE_GOAL} bits of rubbish and come back. I might have something special for you.`, [
        { label: 'Take the picker 🦯', fn: () => { state.hasPicker = true; sfx.pick(); toast('🦯 You got a <b>litter picker</b>! Press E or Space near litter.'); renderQuests(); } },
      ]);
    }
    if (!Q.garbage.done) return say('Keeper Pim', `${GARBAGE_GOAL - state.garbage} more to go! Check under the trees and around the pond. The bins are by the paths.`);
    if (!state.hasSwitch) {
      return say('Keeper Pim', "Marvelous work! Here — the Switch-O-Matic 3000. Clip it on your picker. Q cycles modes: normal, ❄️ ICE and 🔥 FIRE. Fire exterminates… well, anything. Please don't burn my park down.", [
        { label: 'Install the switch ⚡', fn: () => { state.hasSwitch = true; sfx.click(); toast('⚡ <b>Switch-O-Matic 3000</b> installed! <b>Q</b> switches mode, <b>Space</b> or click fires.'); renderQuests(); } },
      ]);
    }
    if (!Q.upgrade.done) return say('Keeper Pim', 'Go on, try both modes! Ice freezes, fire… fires. Try the pond with ice — you can walk on it.');
    if (state.burntTrees > 3) return say('Keeper Pim', `I planted those ${state.burntTrees} trees myself. With my own hands. I'm not crying, it's the smoke.`);
    return say('Keeper Pim', 'Park looks great. Mind the officer — Bramble takes littering VERY personally.');
  }

  function talkSam() {
    if (sam.frozen > 0) return toast('Sam is frozen. This is not how you make friends.');
    if (sam.friend) {
      return say('Sam', pick([
        'Best. Park day. Ever.', 'Did you know ducks have three eyelids? I read that on a bench.',
        'Can we burn a bush again? For science?', "I'm writing about today in my diary. You're in it. Twice.",
      ]));
    }
    say('Sam', "…oh. Hi. Sorry, I'm not great at this. I just moved here and don't really know anyone.", [
      { label: 'Want to hang out?', fn: samHang },
      { label: 'Nice weather, huh?', fn: () => say('Sam', "It's… fine. The pigeons seem into it.", [{ label: 'Want to hang out?', fn: samHang }, { label: 'Bye!' }]) },
      { label: 'Bye!' },
    ]);
  }
  function samHang() {
    const ch = [];
    if (state.flowers > 0) ch.push({ label: '🌸 I found this flower — it\'s for you!', fn: () => { state.flowers--; befriend("For me? …Nobody's ever given me a flower. Okay. Yes. Let's be friends!"); } });
    if (state.hasSwitch) ch.push({ label: '🔥 Want to see my picker shoot fire?', fn: () => befriend("It shoots WHAT?! …Okay, that's the coolest thing I've ever seen. We're friends now. I've decided.") });
    else if (state.hasPicker) ch.push({ label: 'Want to see my litter picker?', fn: () => say('Sam', "It's… a stick with a claw. Cool, I guess. If it did something wild, maybe. Or… I do like flowers.") });
    ch.push({ label: 'Never mind.' });
    say('Sam', 'Hang out? I mean… maybe. What would we even do?' + (ch.length === 1 ? ' (I like flowers, if that helps.)' : ''), ch);
  }
  function befriend(text) {
    sam.friend = true; sam.sitting = false;
    say('Sam', text);
    complete('friend', 'Sam will tag along now.');
  }

  function talkOfficer() {
    if (officer.frozen > 0) return toast('Officer Bramble is frozen. That is almost certainly a crime.');
    say('Officer Bramble', pick([
      "Afternoon. Keep it clean. I've got eyes like a hawk and a whistle like a very angry hawk.",
      'Litter is the gateway crime. First a wrapper, then a bottle, then… anarchy.',
      state.arrests ? "You again. I've got my eye on you." : 'Lovely day. Would be a shame if someone dropped a crisp packet on it.',
    ]));
  }

  // ============================================================ interaction
  function interactables() {
    const L = [];
    const add = (x, y, r, label, fn, pri = 0) => L.push({ x, y, r, label, fn, pri });
    add(grandma.x, grandma.y, 62, 'Talk to Grandma Rosa', talkGrandma, 2);
    add(keeper.x, keeper.y, 62, 'Talk to Keeper Pim', talkKeeper, 2);
    add(sam.x, sam.y, 62, 'Talk to Sam', talkSam, sam.friend ? -1 : 2);
    add(officer.x, officer.y, 55, 'Talk to Officer Bramble', talkOfficer, 1);
    add(booth.x + booth.w / 2, booth.y + booth.h + 10, 70, 'Play Quack-a-Mole', openMinigame, 2);
    for (const b of bins) if (state.bag > 0) add(b.x, b.y, 50, `Empty bag in bin (${state.bag})`, () => { float(b.x, b.y - 30, `+${state.bag} recycled ♻️`, '#e3f7df'); state.bag = 0; sfx.pick(); renderQuests(); }, 3);
    for (const g of garbage) if (!g.taken) add(g.x, g.y, 46, state.hasPicker ? 'Pick up litter' : 'Litter (you need a picker)', () => pickGarbage(g), 4);
    for (const f of flowers) if (!f.picked && !f.burnt) add(f.x, f.y, 42, 'Pick flower', () => pickFlower(f), 3);
    for (const b of bushes) if (!b.burnt) add(b.x, b.y, 56, 'Search bush', () => searchBush(b), 1);
    if (dog.state !== 'hidden' && dog.state !== 'chase') add(dog.x, dog.y, 40, 'Pet Biscuit', () => { float(dog.x, dog.y - 30, '❤️', '#fff', 22); sfx.woof(0.6); }, -3);
    return L;
  }
  function currentTarget() {
    let best = null, bs = Infinity;
    for (const it of interactables()) {
      const d = dist(player.x, player.y, it.x, it.y);
      if (d < it.r) { const s = d - it.pri * 12; if (s < bs) { bs = s; best = it; } }
    }
    return best;
  }
  function interact() { const t = currentTarget(); if (t) t.fn(); }

  function pickGarbage(g) {
    if (!state.hasPicker) {
      if (state.time - state.noPickerWarned > 3) { toast('🤢 Eww, not with your hands! Keeper Pim by the shed has a picker.'); state.noPickerWarned = state.time; }
      return;
    }
    g.taken = true; state.bag++;
    if (!g.dropped) state.garbage++;
    float(g.x, g.y - 16, g.dropped ? 'picked (again)' : `+1 🗑️`, '#fff');
    sfx.pick(); burst(g.x, g.y, '#fff8c8', 6);
    if (state.garbage >= GARBAGE_GOAL) complete('garbage', 'Go tell Keeper Pim!');
    renderQuests();
  }
  function pickFlower(f) {
    f.picked = true; state.flowers++; state.flowersFound++;
    float(f.x, f.y - 16, '🌸 +1', '#fff'); sfx.pick(); burst(f.x, f.y, f.color, 8);
    if (state.flowersFound >= FLOWER_GOAL) complete('flowers', 'Someone lonely might like one…');
    renderQuests();
  }
  function searchBush(b) {
    b.shake = 0.5;
    if (dog.state === 'hidden' && dog.hideBush === b) return dogFound(b, "There he is! Biscuit bursts out covered in leaves.");
    float(b.x, b.y - 36, pick(['just leaves', 'a confused beetle', 'a sock?', 'nothing', 'an acorn stash']), '#fff', 14);
  }

  // ============================================================ littering & the law
  function litter() {
    const type = state.bag > 0 ? pick(['can', 'bottle', 'paper', 'bag']) : 'paper';
    if (state.bag > 0) state.bag--;
    else toast('🍫 You eat a snack. The wrapper slips from your fingers… on purpose.');
    garbage.push({ x: player.x + player.fx * 14, y: player.y + 8, r: 8, type, taken: false, frozen: 0, rot: Math.random() * TAU, dropped: true });
    renderQuests();
    const seen = officer.frozen <= 0 && officer.mode !== 'jail' && dist(officer.x, officer.y, player.x, player.y) < 320;
    if (seen) startChase('Littering in a public park');
    else {
      const witness = [grandma, keeper, sam].find((p) => dist(p.x, p.y, player.x, player.y) < 220);
      if (witness) shout(witness, pick(['Tsk tsk!', 'I SAW that.', 'Really?!']));
      else float(player.x, player.y - 50, 'nobody saw… 😈', '#ffe3de', 14);
    }
  }
  function startChase(charge) {
    if (officer.mode === 'chase') return;
    officer.mode = 'chase'; officer.chaseT = 12; officer.charge = charge;
    shout(officer, 'HALT! 🚨', 2.5); sfx.whistle();
    toast('🚨 <b>Officer Bramble</b> saw that! (Ice might slow him down…)', 'bad');
  }
  function arrest() {
    state.arrests++;
    officer.mode = 'jail';
    state.screen = 'jail'; state.jailT = 8;
    $('#jailText').textContent = pick([
      '"You have the right to remain tidy. Anything you drop can and will be used against you."',
      '"Littering. In MY park. On MY shift." Officer Bramble shakes his head slowly.',
      '"I\'ve seen a lot in twenty years on the park beat, but this…"',
    ]) + (officer.charge !== 'Littering in a public park' ? ` (Additional charge: ${officer.charge}.)` : '');
    $('#jailTime').textContent = '8';
    $('#jail').hidden = false;
    clearKeys();
    complete('arrest', 'A criminal record — in a park game.');
  }
  function release(paid) {
    $('#jail').hidden = true; state.screen = 'play';
    player.x = SPAWN.x; player.y = SPAWN.y; player.fx = 0; player.fy = -1;
    if (dog.state === 'leashed' || dog.state === 'found') { dog.x = player.x + 30; dog.y = player.y + 20; }
    if (sam.friend) { sam.x = player.x - 30; sam.y = player.y + 20; }
    officer.mode = 'patrol'; officer.cool = 4;
    toast(paid ? '💸 You paid the fine. Your wallet weeps quietly.' : '🔓 Released for good behaviour. Stay tidy out there.');
  }

  // ============================================================ picker (normal / ice / fire)
  function switchMode() {
    if (!state.hasSwitch) {
      toast(state.hasPicker ? 'Your picker has no switch… yet. Keeper Pim might help.' : 'You don\'t even have a picker yet.');
      return;
    }
    state.mode = state.mode === 'normal' ? 'ice' : state.mode === 'ice' ? 'fire' : 'normal';
    sfx.click(); renderQuests();
  }
  const RANGE = 120, CONE = Math.cos(0.5);
  function usePicker() {
    if (state.cool > 0) return;
    if (!state.hasPicker) {
      if (state.time - state.noPickerWarned > 3) { toast('You wave your empty hand around. Get a picker from Keeper Pim.'); state.noPickerWarned = state.time; }
      state.cool = 0.4; return;
    }
    const m = state.mode;
    if (m === 'normal') {
      state.cool = 0.25;
      const tx = player.x + player.fx * 24, ty = player.y + player.fy * 24;
      let g = null, bd = 52;
      for (const x of garbage) if (!x.taken) { const d = dist(tx, ty, x.x, x.y); if (d < bd) { bd = d; g = x; } }
      if (g) pickGarbage(g); else { sfx.bonk(); float(tx, ty - 20, 'snap!', '#fff', 12); }
      return;
    }
    state.cool = 0.1;
    const ox = player.x + player.fx * 18, oy = player.y - 16 + player.fy * 14;
    const fire = m === 'fire';
    for (let i = 0; i < 5; i++) {
      const a = Math.atan2(player.fy, player.fx) + (Math.random() - 0.5) * 0.8, sp = 260 + Math.random() * 160;
      particles.push({ x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.42, max: 0.42, size: fire ? 7 : 5, color: fire ? pick(['#ffb02e', '#ff6a00', '#ffd966', '#ff3b1f']) : pick(['#bff0ff', '#e6fbff', '#8fdcff', '#ffffff']), grow: fire });
    }
    if (state.sfxT <= 0) { fire ? sfx.fire() : sfx.ice(); state.sfxT = 0.28; }
    if (fire) state.usedFire = true; else state.usedIce = true;
    if (state.usedFire && state.usedIce) complete('upgrade', 'Your picker is now a weapon of mass tidiness.');

    const hit = (x, y, extra = 0) => {
      const dx = x - ox, dy = y - oy, d = Math.hypot(dx, dy);
      if (d > RANGE + extra) return false;
      if (d < 20 + extra) return true;
      return (dx * player.fx + dy * player.fy) / d > CONE;
    };
    for (const t of trees) if (!t.burnt && hit(t.x, t.y - 20, 14)) {
      if (fire) { t.burnt = true; state.burntTrees++; burst(t.x, t.y - 40, '#555', 18, 60); float(t.x, t.y - 70, '🔥 poof', '#ffd9b3'); }
      else t.frozen = 10;
    }
    for (const b of bushes) if (!b.burnt && hit(b.x, b.y, 12)) {
      if (fire) {
        b.burnt = 30; burst(b.x, b.y, '#555', 10);
        if (dog.state === 'hidden' && dog.hideBush === b) dogFound(b, 'YIP! Biscuit shoots out of the burning bush, fur smoking. Found him!');
      } else { b.frozen = 10; if (dog.state === 'hidden' && dog.hideBush === b) { b.shake = 0.6; float(b.x, b.y - 36, 'brrr-woof?', '#fff', 14); } }
    }
    for (const g of garbage) if (!g.taken && hit(g.x, g.y, 6)) {
      if (fire) { g.taken = true; if (!g.dropped) state.garbage++; burst(g.x, g.y, '#444', 6); float(g.x, g.y - 14, g.dropped ? 'roasted' : '+1 (roasted)', '#ffd9b3', 13); if (state.garbage >= GARBAGE_GOAL) complete('garbage', 'Go tell Keeper Pim!'); renderQuests(); }
      else g.frozen = 8;
    }
    for (const f of flowers) if (!f.picked && !f.burnt && hit(f.x, f.y, 4)) {
      if (fire) { f.burnt = 20; float(f.x, f.y - 14, 'oops 🥀', '#ffd9b3', 13); } else f.frozen = 8;
    }
    for (const p of people) if (hit(p.x, p.y - 20, 12)) {
      if (fire) {
        if (p.frozen > 0) { p.frozen = 0; shout(p, 'Thanks… I think?'); }
        else if (!p.bubble || p.bubble.t < 1) { p.jump = 0.4; shout(p, pick(['HEY!', 'Watch it!', 'My eyebrows!', 'Not cool!'])); }
        if (p === officer && officer.mode !== 'chase' && officer.mode !== 'jail') startChase('Setting a police officer\'s hat on fire');
      } else if (p.frozen <= 0) { p.frozen = p === officer ? 4 : 3; shout(p, 'Brrr!', 1); }
    }
    if (dog.state !== 'hidden' && hit(dog.x, dog.y - 8, 10)) {
      if (fire) { if (dog.frozen > 0) dog.frozen = 0; else if (dog.spin <= 0) { dog.spin = 1; float(dog.x, dog.y - 30, 'YIP!', '#fff'); sfx.woof(0.7); } }
      else dog.frozen = 2;
    }
    if (squirrel.active && hit(squirrel.x, squirrel.y, 8)) float(squirrel.x, squirrel.y - 20, 'nope!', '#fff', 12);
    for (const d of ducks) if (!d.gone && hit(d.x, d.y, 10)) {
      if (fire) { if (!d.fly) { d.fly = 0.01; d.frozen = 0; sfx.quack(); float(d.x, d.y - 20, 'QUACK!', '#fff'); } }
      else if (!d.fly) d.frozen = 5;
    }
    // pond: ice builds walkable floes, fire melts them
    for (let s = 30; s <= RANGE; s += 30) {
      const px = ox + player.fx * s, py = oy + 16 + player.fy * s;
      if (!inPond(px, py, 10)) continue;
      if (fire) {
        for (let i = iceP.length - 1; i >= 0; i--) if (dist(px, py, iceP[i].x, iceP[i].y) < iceP[i].r + 10) iceP.splice(i, 1);
        if (Math.random() < 0.3) particles.push({ x: px, y: py, vx: 0, vy: -40, life: 0.8, max: 0.8, size: 8, color: 'rgba(255,255,255,0.6)', grow: true });
      } else {
        const near = iceP.find((p) => dist(px, py, p.x, p.y) < 18);
        if (near) near.life = 25; else iceP.push({ x: px, y: py, r: 34, life: 25 });
      }
    }
  }

  // ============================================================ dog story
  function startSquirrelChase() {
    complete('walk', 'Biscuit is loving this. What could possibly go wrong?');
    const cands = bushes.filter((b) => !b.burnt).map((b) => ({ b, d: dist(b.x, b.y, player.x, player.y) }));
    let options = cands.filter((c) => c.d > 450 && c.d < 950);
    if (!options.length) options = cands.sort((a, b) => b.d - a.d).slice(0, 3);
    dog.hideBush = pick(options).b;
    const a = Math.random() * TAU;
    Object.assign(squirrel, { active: true, x: dog.x + Math.cos(a) * 70, y: dog.y + Math.sin(a) * 70, phase: 'run', tree: null });
    dog.state = 'chase';
    sfx.woof(); shout(grandma, 'BISCUIT, NO!', 3);
    toast('🐿️ <b>SQUIRREL!</b> Biscuit yanks the leash out of your hand!', 'bad');
  }
  function dogFound(b, text) {
    dog.state = 'found'; dog.x = b.x; dog.y = b.y + 10; b.shake = 0.6;
    sfx.woof(); toast(`🐕 ${text}`, 'good'); renderQuests();
  }
  function moveToward(e, tx, ty, sp, dt) {
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
    if (d < 1) return 0;
    const s = Math.min(d, sp * dt); e.x += (dx / d) * s; e.y += (dy / d) * s;
    if (e.fx !== undefined) { e.fx = dx / d; e.fy = dy / d; }
    return d;
  }
  function updateDog(dt) {
    dog.wag += dt * 12;
    if (dog.spin > 0) dog.spin -= dt;
    if (dog.frozen > 0) { dog.frozen -= dt; return; }
    switch (dog.state) {
      case 'grandma': case 'home':
        moveToward(dog, grandma.x + 40, grandma.y + 24, 120, dt); break;
      case 'leashed': case 'found': {
        const tx = player.x - player.fx * 36 + 14, ty = player.y - player.fy * 36 + 8;
        if (dist(dog.x, dog.y, tx, ty) > 8) moveToward(dog, tx, ty, dist(dog.x, dog.y, tx, ty) > 80 ? 320 : 210, dt);
        if (dog.state === 'found' && dist(player.x, player.y, grandma.x, grandma.y) < 90) returnDog();
        break;
      }
      case 'chase': {
        const tgt = squirrel.active && squirrel.phase === 'run' ? squirrel : dog.hideBush;
        if (dog.hideBush.burnt) dog.hideBush = bushes.find((b) => !b.burnt) || dog.hideBush;
        const d = moveToward(dog, tgt.x, tgt.y, 285, dt);
        if (tgt === dog.hideBush && d < 12) {
          dog.state = 'hidden'; dog.bark = 1.5; dog.hideBush.shake = 0.6;
          complete('lose', "Biscuit vanished into a bush. Grandma is… not thrilled.");
          shout(grandma, 'BISCUIT?!', 3);
        }
        break;
      }
      case 'hidden':
        dog.x = dog.hideBush.x; dog.y = dog.hideBush.y;
        dog.bark -= dt;
        if (dog.bark <= 0) {
          dog.bark = 3.2; dog.hideBush.shake = 0.5;
          float(dog.x + (Math.random() - 0.5) * 20, dog.y - 40, 'woof!', '#fff', 16);
          sfx.woof(clamp(1 - dist(player.x, player.y, dog.x, dog.y) / 1400, 0.15, 1));
        }
        break;
    }
  }
  function updateSquirrel(dt) {
    if (!squirrel.active) return;
    if (squirrel.phase === 'run') {
      if (moveToward(squirrel, dog.hideBush.x, dog.hideBush.y, 300, dt) < 10) {
        squirrel.phase = 'tree';
        squirrel.tree = trees.filter((t) => !t.burnt).sort((a, b) => dist(a.x, a.y, squirrel.x, squirrel.y) - dist(b.x, b.y, squirrel.x, squirrel.y))[0];
      }
    } else if (squirrel.phase === 'tree') {
      if (!squirrel.tree || moveToward(squirrel, squirrel.tree.x, squirrel.tree.y - 30, 320, dt) < 8) squirrel.active = false;
    }
  }

  // ============================================================ officer
  function updateOfficer(dt) {
    if (officer.frozen > 0) return;
    if (officer.cool > 0) officer.cool -= dt;
    if (officer.mode === 'patrol') {
      const [tx, ty] = route[officer.wp];
      if (moveToward(officer, tx, ty, 85, dt) < 4) officer.wp = (officer.wp + 1) % route.length;
    } else if (officer.mode === 'chase') {
      officer.chaseT -= dt;
      const d = moveToward(officer, player.x, player.y, 250, dt);
      if (d < 24 && state.screen === 'play' && !dialogOpen) arrest();
      else if (officer.chaseT <= 0) {
        officer.mode = 'patrol'; shout(officer, "I'll remember that face!", 3);
        toast('😮‍💨 Officer Bramble gave up the chase. For now.');
      }
    }
  }

  // ============================================================ movement & update
  const keys = {};
  const stick = { x: 0, y: 0 };
  let mouse = { held: false, wx: 0, wy: 0 };
  function clearKeys() { for (const k in keys) keys[k] = false; mouse.held = false; }

  function blocked(x, y, r, fromWater) {
    if (x < 30 + r || y < 30 + r || x > W - 30 - r || y > H - 30 - r) return !(y > H - 60 && Math.abs(x - 1000) < 40 && y < H - 10);
    for (const t of trees) if (dist(x, y, t.x, t.y) < r + (t.burnt ? 8 : 14)) return true;
    for (const b of bushes) if (!b.burnt && dist(x, y, b.x, b.y) < r + 14) return true;
    for (const R of rects) if (circleRect(x, y, r, R)) return true;
    for (const b of bins) if (dist(x, y, b.x, b.y) < r + b.r) return true;
    if (!fromWater && inWater(x, y)) return true;
    return false;
  }
  function tryMove(e, nx, ny) {
    const fw = inWater(e.x, e.y);
    if (!blocked(nx, e.y, e.r, fw)) e.x = nx;
    if (!blocked(e.x, ny, e.r, fw)) e.y = ny;
  }

  function update(dt) {
    state.time += dt;
    if (state.cool > 0) state.cool -= dt;
    if (state.sfxT > 0) state.sfxT -= dt;

    let ix = 0, iy = 0;
    if (keys.arrowleft || keys.a) ix -= 1;
    if (keys.arrowright || keys.d) ix += 1;
    if (keys.arrowup || keys.w) iy -= 1;
    if (keys.arrowdown || keys.s) iy += 1;
    ix += stick.x; iy += stick.y;
    const len = Math.hypot(ix, iy);
    if (len > 0.15) {
      const n = Math.max(1, len);
      ix /= n; iy /= n;
      const water = inWater(player.x, player.y);
      const sp = player.speed * (water ? 0.45 : 1);
      const ox = player.x, oy = player.y;
      tryMove(player, player.x + ix * sp * dt, player.y + iy * sp * dt);
      const moved = dist(ox, oy, player.x, player.y);
      player.walk += moved * 0.09;
      if (!mouse.held) { player.fx = ix / Math.hypot(ix, iy); player.fy = iy / Math.hypot(ix, iy); }
      if (dog.state === 'leashed') {
        state.walkDist += moved;
        if (state.walkDist >= WALK_GOAL) startSquirrelChase();
      }
    }
    if (mouse.held) {
      const dx = mouse.wx - player.x, dy = mouse.wy - (player.y - 16), d = Math.hypot(dx, dy);
      if (d > 4) { player.fx = dx / d; player.fy = dy / d; }
    }
    if (keys[' '] || mouse.held) usePicker();

    const water = inWater(player.x, player.y);
    if (water && !player.wasWater) { sfx.splash(); burst(player.x, player.y, '#bfe6ff', 14); toast('💦 Splash! The ice melted. You are now swimming. With dignity.'); }
    player.wasWater = water;

    updateDog(dt);
    updateSquirrel(dt);
    updateOfficer(dt);

    for (const p of people) {
      if (p.frozen > 0) p.frozen -= dt;
      if (p.jump > 0) p.jump -= dt;
      if (p.bubble && (p.bubble.t -= dt) <= 0) p.bubble = null;
    }
    if (sam.friend && sam.frozen <= 0) {
      const tx = player.x - player.fx * 44 - 20, ty = player.y - player.fy * 44 + 4;
      const d = dist(sam.x, sam.y, tx, ty);
      if (d > 14) { moveToward(sam, tx, ty, d > 120 ? 300 : 175, dt); sam.walk = (sam.walk || 0) + dt * 12; }
    }
    for (const t of trees) if (t.frozen > 0) t.frozen -= dt;
    for (const b of bushes) {
      if (b.frozen > 0) b.frozen -= dt;
      if (b.shake > 0) b.shake -= dt;
      if (b.burnt > 0 && (b.burnt -= dt) <= 0) b.burnt = 0;
    }
    for (const g of garbage) if (g.frozen > 0) g.frozen -= dt;
    for (const f of flowers) {
      if (f.frozen > 0) f.frozen -= dt;
      if (f.burnt > 0 && (f.burnt -= dt) <= 0) f.burnt = 0;
    }
    for (let i = iceP.length - 1; i >= 0; i--) if ((iceP[i].life -= dt) <= 0) iceP.splice(i, 1);
    for (const d of ducks) {
      if (d.gone > 0) { if ((d.gone -= dt) <= 0) { d.gone = 0; d.fly = 0; } continue; }
      if (d.fly) { d.fly += dt; d.y -= 220 * dt; d.x += 120 * dt; if (d.fly > 2.5) d.gone = 15; continue; }
      if (d.frozen > 0) { d.frozen -= dt; continue; }
      d.a += d.sp * dt;
      d.x = pond.x + Math.cos(d.a) * pond.rx * d.rr; d.y = pond.y + Math.sin(d.a) * pond.ry * d.rr;
    }
  }

  function burst(x, y, color, n = 8, sp = 120) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = Math.random() * sp;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.7, max: 0.7, size: 4, color });
    }
  }
  function updateFx(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94;
      if ((p.life -= dt) <= 0) particles.splice(i, 1);
    }
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i]; f.y -= 28 * dt;
      if ((f.life -= dt) <= 0) floats.splice(i, 1);
    }
  }

  // ============================================================ rendering
  let dpr = 1, scale = 1, camX = 0, camY = 0, viewW = 0, viewH = 0;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(innerWidth * dpr); canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
    scale = clamp(Math.min(innerWidth / 1000, innerHeight / 700), 0.55, 1.5) * dpr;
  }
  addEventListener('resize', resize);

  const bg = document.createElement('canvas');
  function buildBg() {
    bg.width = W; bg.height = H;
    const g = bg.getContext('2d');
    g.fillStyle = '#86c86f'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(60,130,60,0.10)' : 'rgba(210,245,160,0.12)';
      g.beginPath(); g.ellipse(rand(0, W), rand(0, H), rand(20, 90), rand(15, 60), rand(0, 3), 0, TAU); g.fill();
    }
    g.strokeStyle = 'rgba(50,110,50,0.35)'; g.lineWidth = 1.2;
    for (let i = 0; i < 6000; i++) {
      const x = rand(0, W), y = rand(0, H);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-2, 2), y - rand(3, 6)); g.stroke();
    }
    g.lineCap = 'round';
    for (const [w, c] of [[52, '#c9ae74'], [42, '#ead9a6']]) {
      g.strokeStyle = c; g.lineWidth = w;
      for (const p of paths) { g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[2], p[3]); g.stroke(); }
      g.beginPath(); g.ellipse(pond.x, pond.y, pond.rx + 55, pond.ry + 55, 0, 0, TAU); g.stroke();
    }
    g.fillStyle = 'rgba(160,130,80,0.35)';
    for (let i = 0; i < 900; i++) {
      const p = paths[Math.floor(rnd() * paths.length)], t = rnd();
      g.fillRect(p[0] + (p[2] - p[0]) * t + rand(-16, 16), p[1] + (p[3] - p[1]) * t + rand(-16, 16), 2, 2);
    }
    // decorative clover & daisies
    for (let i = 0; i < 400; i++) {
      const x = rand(0, W), y = rand(0, H);
      if (paths.some((p) => segDist(x, y, ...p) < 30) || inPond(x, y, 70)) continue;
      g.fillStyle = rnd() < 0.7 ? 'rgba(255,255,255,0.8)' : 'rgba(255,230,90,0.8)';
      g.beginPath(); g.arc(x, y, 1.6, 0, TAU); g.fill();
    }
    // fence
    g.strokeStyle = '#8a5a2b'; g.lineWidth = 4;
    const fence = (x1, y1, x2, y2) => {
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      g.beginPath(); g.moveTo(x1, y1 - 8 * (y1 === y2)); g.lineTo(x2, y2 - 8 * (y1 === y2)); g.stroke();
      const n = Math.hypot(x2 - x1, y2 - y1) / 40;
      g.fillStyle = '#6e4420';
      for (let i = 0; i <= n; i++) { const t = i / n; g.fillRect(x1 + (x2 - x1) * t - 3, y1 + (y2 - y1) * t - 14, 6, 18); }
    };
    fence(20, 22, W - 20, 22); fence(20, 22, 20, H - 16); fence(W - 20, 22, W - 20, H - 16);
    fence(20, H - 16, 955, H - 16); fence(1045, H - 16, W - 20, H - 16);
    g.fillStyle = '#7a7a7a'; g.fillRect(946, H - 60, 14, 50); g.fillRect(1040, H - 60, 14, 50);
  }

  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function shadow(x, y, rx, ry = rx * 0.4) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill(); }

  function drawPerson(p, { walk = 0, cap = null, isPlayer = false } = {}) {
    const moving = walk !== 0;
    const bob = p.jump > 0 ? -Math.sin((p.jump / 0.4) * Math.PI) * 14 : moving ? Math.abs(Math.sin(walk)) * -2 : 0;
    ctx.save(); ctx.translate(p.x, p.y);
    shadow(0, 0, 12);
    ctx.translate(0, bob);
    if (!p.sitting) {
      const sw = moving ? Math.sin(walk) * 4 : 0;
      ctx.fillStyle = '#3b3b4f';
      ctx.fillRect(-7 + sw * 0.3, -12, 5, 12 + sw * 0.4);
      ctx.fillRect(2 - sw * 0.3, -12, 5, 12 - sw * 0.4);
    } else {
      ctx.fillStyle = '#3b3b4f'; ctx.fillRect(-8, -12, 16, 6);
    }
    ctx.fillStyle = p.shirt; roundRect(-10, -32, 20, 22, 7); ctx.fill();
    if (p.cop) { ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(-4, -25, 2.6, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(0, -40, 9, 0, TAU); ctx.fill();
    ctx.fillStyle = p.hair; ctx.beginPath(); ctx.arc(0, -42, 9.5, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
    if (p.hat || cap) {
      ctx.fillStyle = p.hat || cap;
      ctx.beginPath(); ctx.arc(0, -44, 9, Math.PI, 0); ctx.fill();
      ctx.fillRect(-10 + (p.fx < 0 ? -4 : 0), -45, 20 + 4, 3);
      if (p.cop) { ctx.fillStyle = '#ffd23f'; ctx.fillRect(-2, -51, 4, 4); }
    }
    if (p.fy < 0.6 || isPlayer) {
      const ex = (p.fx || 0) * 3;
      if ((p.fy || 0) > -0.7) { ctx.fillStyle = '#222'; ctx.fillRect(-4 + ex, -41, 2, 2.5); ctx.fillRect(2 + ex, -41, 2, 2.5); }
    } else { ctx.fillStyle = '#222'; ctx.fillRect(-4, -41, 2, 2.5); ctx.fillRect(2, -41, 2, 2.5); }
    if (p === grandma) { ctx.strokeStyle = '#6b4423'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(13, -22); ctx.lineTo(16, 0); ctx.stroke(); }
    if (p.frozen > 0) {
      ctx.fillStyle = 'rgba(190,235,255,0.62)'; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
      roundRect(-16, -56, 32, 58, 6); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-10, -50); ctx.lineTo(-4, -30); ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayer() {
    const moving = keys.w || keys.a || keys.s || keys.d || keys.arrowup || keys.arrowdown || keys.arrowleft || keys.arrowright || Math.hypot(stick.x, stick.y) > 0.15;
    const p = Object.assign({}, player, { shirt: '#3a86ff', hair: '#5a3a1a', jump: 0 });
    const behind = player.fy < -0.3;
    if (behind) drawPickerTool();
    drawPerson(p, { walk: moving ? player.walk : 0, cap: '#e63946', isPlayer: true });
    if (!behind) drawPickerTool();
    if (inWater(player.x, player.y)) {
      ctx.fillStyle = 'rgba(74,163,223,0.85)'; ctx.beginPath(); ctx.ellipse(player.x, player.y - 6, 18, 9, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(player.x, player.y - 6, 20 + Math.sin(state.time * 6) * 2, 10, 0, 0, TAU); ctx.stroke();
    }
  }
  function drawPickerTool() {
    if (!state.hasPicker) return;
    const hx = player.x + player.fx * 6 + (player.fy > 0 ? 9 : 0), hy = player.y - 20;
    const tx = player.x + player.fx * 34, ty = player.y - 16 + player.fy * 22;
    ctx.strokeStyle = '#555'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
    const col = state.mode === 'fire' ? '#ff6a00' : state.mode === 'ice' ? '#6fd6ff' : '#999';
    if (state.mode !== 'normal') { ctx.fillStyle = col + '55'; ctx.beginPath(); ctx.arc(tx, ty, 9 + Math.sin(state.time * 10) * 2, 0, TAU); ctx.fill(); }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(tx, ty, 4, 0, TAU); ctx.fill();
    if (state.hasSwitch) { ctx.fillStyle = '#ffd23f'; ctx.fillRect((hx + tx) / 2 - 3, (hy + ty) / 2 - 3, 6, 6); }
  }

  function drawDog() {
    if (dog.state === 'hidden') return;
    const { x, y } = dog;
    if (dog.state === 'leashed') {
      ctx.strokeStyle = '#d62828'; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(player.x + 8, player.y - 20); ctx.quadraticCurveTo((player.x + x) / 2, Math.max(player.y, y) + 8, x + 8, y - 12); ctx.stroke();
    }
    ctx.save(); ctx.translate(x, y);
    if (dog.spin > 0) ctx.rotate(dog.spin * 12);
    shadow(0, 0, 14, 5);
    const flip = (dog.state === 'leashed' || dog.state === 'found' ? player.x < x : dog.state === 'chase' ? (squirrel.active ? squirrel.x : dog.hideBush.x) < x : false) ? -1 : 1;
    ctx.scale(flip, 1);
    ctx.fillStyle = '#c68a4a';
    ctx.strokeStyle = '#c68a4a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-12, -12); ctx.lineTo(-19, -18 + Math.sin(dog.wag) * 4); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, -10, 13, 7, 0, 0, TAU); ctx.fill();
    ctx.fillRect(-9, -6, 3, 6); ctx.fillRect(6, -6, 3, 6);
    ctx.beginPath(); ctx.arc(12, -17, 7, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a5a2b'; ctx.beginPath(); ctx.ellipse(9, -20, 3, 6, 0.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(19, -16, 2, 0, TAU); ctx.fill(); ctx.fillRect(13, -19, 2, 2);
    ctx.fillStyle = '#d62828'; ctx.fillRect(6, -14, 5, 3);
    if (dog.frozen > 0) { ctx.fillStyle = 'rgba(190,235,255,0.6)'; roundRect(-20, -28, 42, 30, 5); ctx.fill(); }
    ctx.restore();
  }

  function drawTree(t) {
    ctx.save(); ctx.translate(t.x, t.y);
    if (t.burnt) {
      shadow(0, 2, 16, 6);
      ctx.fillStyle = '#2b2522'; roundRect(-8, -12, 16, 14, 3); ctx.fill();
      ctx.fillStyle = 'rgba(60,60,60,0.5)'; ctx.beginPath(); ctx.ellipse(0, 3, 22, 7, 0, 0, TAU); ctx.fill();
      ctx.restore(); return;
    }
    const s = t.s;
    shadow(4, 2, 30 * s, 10 * s);
    ctx.fillStyle = '#7a4f2a'; ctx.fillRect(-6 * s, -34 * s, 12 * s, 34 * s);
    const fz = t.frozen > 0;
    const base = fz ? '#b9e6f7' : `hsl(${115 + t.hue},45%,36%)`, hi = fz ? '#e6f8ff' : `hsl(${110 + t.hue},50%,46%)`;
    ctx.fillStyle = base;
    for (const [cx, cy, r] of [[-16, -52, 20], [16, -52, 20], [0, -70, 24], [0, -48, 22]]) { ctx.beginPath(); ctx.arc(cx * s, cy * s, r * s, 0, TAU); ctx.fill(); }
    ctx.fillStyle = hi;
    for (const [cx, cy, r] of [[-8, -70, 12], [10, -58, 10], [-16, -54, 8]]) { ctx.beginPath(); ctx.arc(cx * s, cy * s, r * s, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  function drawBush(b) {
    ctx.save(); ctx.translate(b.x + (b.shake > 0 ? Math.sin(state.time * 50) * 3 : 0), b.y);
    if (b.burnt) { ctx.fillStyle = 'rgba(50,45,40,0.6)'; ctx.beginPath(); ctx.ellipse(0, 0, 20, 8, 0, 0, TAU); ctx.fill(); ctx.restore(); return; }
    shadow(0, 2, 22, 7);
    const fz = b.frozen > 0;
    ctx.fillStyle = fz ? '#a9dcef' : '#3f8f3f';
    for (const [cx, cy, r] of [[-11, -10, 13], [11, -10, 13], [0, -18, 14]]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); }
    ctx.fillStyle = fz ? '#dff5ff' : '#56a94f';
    ctx.beginPath(); ctx.arc(-4, -22, 6, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(9, -14, 5, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawGarbage(g) {
    ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.rot);
    switch (g.type) {
      case 'can': ctx.fillStyle = '#d62828'; ctx.fillRect(-7, -4, 14, 8); ctx.fillStyle = '#ccc'; ctx.fillRect(5, -4, 3, 8); break;
      case 'bottle': ctx.fillStyle = 'rgba(80,170,90,0.85)'; roundRect(-9, -4, 15, 8, 3); ctx.fill(); ctx.fillRect(6, -2, 5, 4); break;
      case 'paper': ctx.fillStyle = '#f4f4f4'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill(); ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-3, -2); ctx.lineTo(3, 1); ctx.stroke(); break;
      default: ctx.fillStyle = '#9aa0a6'; ctx.beginPath(); ctx.ellipse(0, 0, 9, 6, 0, 0, TAU); ctx.fill(); ctx.fillStyle = '#7d8388'; ctx.fillRect(-2, -8, 4, 4);
    }
    if (g.frozen > 0) { ctx.strokeStyle = '#8fdcff'; ctx.lineWidth = 2; ctx.strokeRect(-11, -8, 22, 16); }
    ctx.restore();
  }
  function drawFlower(f) {
    if (f.picked) return;
    ctx.save(); ctx.translate(f.x, f.y);
    if (f.burnt) { ctx.fillStyle = '#3a3a3a'; ctx.fillRect(-1, -8, 2, 8); ctx.restore(); return; }
    ctx.strokeStyle = '#2f7d32'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -12); ctx.stroke();
    ctx.fillStyle = '#3f9b4f'; ctx.beginPath(); ctx.ellipse(4, -5, 4, 2, -0.5, 0, TAU); ctx.fill();
    const sway = Math.sin(state.time * 2 + f.x) * 1.5;
    ctx.fillStyle = f.frozen > 0 ? '#dff5ff' : f.color;
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; ctx.beginPath(); ctx.arc(sway + Math.cos(a) * 5, -15 + Math.sin(a) * 5, 3.8, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#ffcc33'; ctx.beginPath(); ctx.arc(sway, -15, 3, 0, TAU); ctx.fill();
    // glint so flowers are findable
    if (Math.sin(state.time * 3 + f.y) > 0.9) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(sway + 6, -24, 3, 3); }
    ctx.restore();
  }
  function drawSquirrel() {
    if (!squirrel.active) return;
    ctx.save(); ctx.translate(squirrel.x, squirrel.y);
    ctx.fillStyle = '#a0522d';
    ctx.beginPath(); ctx.ellipse(-8, -12, 6, 10, -0.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -6, 7, 5, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(6, -10, 4, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawDuck(d) {
    if (d.gone) return;
    ctx.save(); ctx.translate(d.x, d.y);
    if (!d.fly) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(0, 2, 14, 4, 0, 0, TAU); ctx.stroke(); }
    const flap = d.fly ? Math.sin(d.fly * 30) * 8 : 0;
    ctx.fillStyle = '#f5f5f5'; ctx.beginPath(); ctx.ellipse(0, -3, 11, 6, 0, 0, TAU); ctx.fill();
    if (d.fly) { ctx.beginPath(); ctx.ellipse(-2, -6 - flap, 8, 3, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#2e7d32'; ctx.beginPath(); ctx.arc(8, -10, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff9f1c'; ctx.fillRect(12, -10, 6, 3);
    if (d.frozen > 0) { ctx.fillStyle = 'rgba(200,240,255,0.7)'; roundRect(-14, -18, 34, 22, 4); ctx.fill(); }
    ctx.restore();
  }
  function drawPond() {
    ctx.save();
    ctx.fillStyle = '#9fd5ef'; ctx.beginPath(); ctx.ellipse(pond.x, pond.y, pond.rx + 6, pond.ry + 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#4aa3df'; ctx.beginPath(); ctx.ellipse(pond.x, pond.y, pond.rx, pond.ry, 0, 0, TAU); ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const x = pond.x + Math.cos(i * 2.1) * 140, y = pond.y + Math.sin(i * 1.7) * 90, r = ((state.time * 12 + i * 11) % 40);
      ctx.globalAlpha = 1 - r / 40; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.4, 0, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const p of iceP) {
      ctx.globalAlpha = clamp(p.life / 4, 0, 1) * 0.95;
      ctx.fillStyle = '#e6f7ff'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#a8d8ef'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x - 12, p.y - 6); ctx.lineTo(p.x + 4, p.y + 2); ctx.lineTo(p.x + 14, p.y - 8); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // lily pads
    ctx.fillStyle = '#3f9b4f';
    for (const [x, y] of [[1300, 380], [1520, 500], [1560, 360]]) { ctx.beginPath(); ctx.arc(x, y, 10, 0.3, TAU - 0.3); ctx.lineTo(x, y); ctx.fill(); }
  }
  function drawBench(b) {
    ctx.save(); ctx.translate(b.x, b.y);
    shadow(0, 0, 34, 8);
    ctx.fillStyle = '#8a5a2b'; ctx.fillRect(-34, -30, 68, 6); ctx.fillRect(-34, -22, 68, 5);
    ctx.fillStyle = '#a86d35'; ctx.fillRect(-36, -14, 72, 8);
    ctx.fillStyle = '#444'; ctx.fillRect(-30, -6, 4, 7); ctx.fillRect(26, -6, 4, 7);
    ctx.restore();
  }
  function drawBin(b) {
    ctx.save(); ctx.translate(b.x, b.y);
    shadow(0, 0, 12, 5);
    ctx.fillStyle = '#2e7d32'; roundRect(-10, -26, 20, 26, 3); ctx.fill();
    ctx.fillStyle = '#1b5e20'; ctx.fillRect(-12, -28, 24, 5);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('♻', 0, -9);
    ctx.restore();
  }
  function drawShed() {
    const { x, y, w, h } = shed;
    shadow(x + w / 2, y + h, w / 2 + 10, 12);
    ctx.fillStyle = '#b5764a'; ctx.fillRect(x, y + 30, w, h - 30);
    ctx.fillStyle = '#9a5f38'; for (let i = 0; i < w; i += 17) ctx.fillRect(x + i, y + 30, 2, h - 30);
    ctx.fillStyle = '#6b3e26'; ctx.beginPath(); ctx.moveTo(x - 12, y + 34); ctx.lineTo(x + w / 2, y - 10); ctx.lineTo(x + w + 12, y + 34); ctx.fill();
    ctx.fillStyle = '#4a2a18'; ctx.fillRect(x + w / 2 - 18, y + h - 52, 36, 52);
    ctx.fillStyle = '#fffdf6'; roundRect(x + 20, y + 44, 70, 20, 4); ctx.fill();
    ctx.fillStyle = '#2d2a26'; ctx.font = 'bold 11px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('PARK KEEPER', x + 55, y + 58);
  }
  function drawBooth() {
    const { x, y, w, h } = booth;
    shadow(x + w / 2, y + h, w / 2 + 8, 10);
    ctx.fillStyle = '#fff3d6'; ctx.fillRect(x, y + 20, w, h - 20);
    for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#fff' : '#e63946'; ctx.fillRect(x - 8 + i * ((w + 16) / 6), y, (w + 16) / 6, 22); }
    ctx.fillStyle = '#ffd23f'; roundRect(x + 10, y + 32, w - 20, 24, 5); ctx.fill();
    ctx.fillStyle = '#2d2a26'; ctx.font = 'bold 14px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('QUACK-A-MOLE', x + w / 2, y + 49);
    for (let i = 0; i < 3; i++) { ctx.fillStyle = '#3b2a1c'; ctx.beginPath(); ctx.ellipse(x + 30 + i * 45, y + h - 5, 12, 4, 0, 0, TAU); ctx.fill(); }
  }
  function drawBubble(x, y, text) {
    ctx.font = '600 14px Fredoka, sans-serif'; ctx.textAlign = 'center';
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = '#fffdf6'; ctx.strokeStyle = '#2d2a26'; ctx.lineWidth = 2;
    roundRect(x - w / 2, y - 26, w, 24, 10); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 5, y - 3); ctx.lineTo(x, y + 5); ctx.lineTo(x + 5, y - 3); ctx.fill();
    ctx.fillStyle = '#2d2a26'; ctx.fillText(text, x, y - 9);
  }

  function render() {
    const cw = canvas.width, ch = canvas.height;
    viewW = cw / scale; viewH = ch / scale;
    camX = viewW >= W ? (W - viewW) / 2 : clamp(player.x - viewW / 2, 0, W - viewW);
    camY = viewH >= H ? (H - viewH) / 2 : clamp(player.y - 30 - viewH / 2, 0, H - viewH);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#5f9e4f'; ctx.fillRect(0, 0, cw, ch);
    ctx.setTransform(scale, 0, 0, scale, -camX * scale, -camY * scale);
    ctx.drawImage(bg, 0, 0);
    drawPond();
    for (const d of ducks) if (!d.fly) drawDuck(d);
    for (const g of garbage) if (!g.taken) drawGarbage(g);

    const inView = (x, y, m = 120) => x > camX - m && x < camX + viewW + m && y > camY - m && y < camY + viewH + m + 60;
    const list = [];
    for (const t of trees) if (inView(t.x, t.y)) list.push([t.y, () => drawTree(t)]);
    for (const b of bushes) if (inView(b.x, b.y)) list.push([b.y, () => drawBush(b)]);
    for (const f of flowers) if (inView(f.x, f.y)) list.push([f.y - 1, () => drawFlower(f)]);
    for (const b of benches) list.push([b.y - 8, () => drawBench(b)]);
    for (const b of bins) list.push([b.y, () => drawBin(b)]);
    list.push([shed.y + shed.h, drawShed]);
    list.push([booth.y + booth.h, drawBooth]);
    for (const p of people) list.push([p.y, () => drawPerson(p, { walk: p === officer && officer.frozen <= 0 ? state.time * (officer.mode === 'chase' ? 18 : 8) : p === sam && sam.friend ? sam.walk || 0 : 0 })]);
    list.push([dog.y, drawDog]);
    list.push([squirrel.y, drawSquirrel]);
    list.push([player.y, drawPlayer]);
    list.sort((a, b) => a[0] - b[0]);
    for (const [, fn] of list) fn();

    for (const d of ducks) if (d.fly) drawDuck(d);
    for (const p of particles) {
      const k = p.life / p.max;
      ctx.globalAlpha = clamp(k * 1.4, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.grow ? p.size * (1.6 - k) : p.size * k + 1, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const p of people) if (p.bubble) drawBubble(p.x, p.y - 58 + (p.jump > 0 ? -12 : 0), p.bubble.text);
    ctx.textAlign = 'center';
    for (const f of floats) {
      ctx.globalAlpha = clamp(f.life, 0, 1);
      ctx.font = `700 ${f.size}px Fredoka, sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    if (officer.mode === 'chase') {
      ctx.fillStyle = Math.sin(state.time * 20) > 0 ? '#ff2b2b' : '#2b6bff';
      ctx.beginPath(); ctx.arc(officer.x, officer.y - 62, 5, 0, TAU); ctx.fill();
    }

    if (state.screen === 'play' && !dialogOpen) {
      const t = currentTarget();
      if (t) {
        const label = (matchMedia('(pointer: coarse)').matches ? '' : 'E  ') + t.label;
        ctx.font = '600 13px Fredoka, sans-serif';
        const w = ctx.measureText(label).width + 16, x = t.x, y = t.y - 62;
        ctx.fillStyle = 'rgba(45,42,38,0.85)'; roundRect(x - w / 2, y - 16, w, 22, 8); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(label, x, y);
      }
    }
  }

  // ============================================================ Quack-a-mole
  const MOLE = (gold) => `<svg viewBox="0 0 60 64"><ellipse cx="30" cy="40" rx="23" ry="24" fill="${gold ? '#f2c230' : '#6b4a33'}"/><ellipse cx="30" cy="48" rx="13" ry="10" fill="${gold ? '#ffe27a' : '#c79a7a'}"/><circle cx="21" cy="31" r="3.2" fill="#111"/><circle cx="39" cy="31" r="3.2" fill="#111"/><ellipse cx="30" cy="40" rx="6.5" ry="4.5" fill="#f28ca0"/><path d="M18 40h-9M18 43l-8 3M42 40h9M42 43l8 3" stroke="#222" stroke-width="1.2"/></svg>`;
  const DUCK = `<svg viewBox="0 0 60 64"><ellipse cx="30" cy="48" rx="24" ry="16" fill="#fafafa"/><circle cx="30" cy="26" r="15" fill="#2e7d32"/><rect x="18" y="37" width="24" height="4" fill="#fff"/><path d="M28 30 h22 l-4 6 h-18z" fill="#ff9f1c"/><circle cx="25" cy="22" r="3" fill="#111"/><circle cx="36" cy="22" r="3" fill="#111"/></svg>`;
  const mg = { active: false, running: false, t: 30, score: 0, spawn: 0, holes: [] };
  const grid = $('#mgGrid');
  for (let i = 0; i < 9; i++) {
    const b = document.createElement('button');
    b.className = 'hole';
    b.innerHTML = `<span class="num">${i + 1}</span><div class="critter"></div><div class="fx"></div>`;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); whack(i); });
    grid.appendChild(b);
    mg.holes.push({ el: b, kind: null, t: 0, fxT: 0 });
  }
  function openMinigame() {
    mg.active = true; state.screen = 'minigame'; clearKeys();
    $('#minigame').hidden = false; $('#mgBest').textContent = state.quackBest;
    $('#mgMsg').textContent = state.mode === 'fire' ? 'Your picker is in FIRE mode. The moles are sweating.' : state.mode === 'ice' ? 'ICE mode: bonked critters get chilly.' : 'Click the holes or use keys 1–9.';
    $('#mgStart').textContent = 'Start';
  }
  function closeMinigame() {
    mg.active = false; mg.running = false; state.screen = 'play';
    $('#minigame').hidden = true;
    for (const h of mg.holes) { h.kind = null; h.el.classList.remove('up'); }
  }
  function startMg() {
    audio();
    Object.assign(mg, { running: true, t: 30, score: 0, spawn: 0.4 });
    for (const h of mg.holes) { h.kind = null; h.el.classList.remove('up'); h.el.querySelector('.fx').textContent = ''; }
    $('#mgMsg').textContent = 'Go go go!'; $('#mgStart').textContent = 'Restart';
    updateMgUI();
  }
  function updateMgUI() { $('#mgScore').textContent = mg.score; $('#mgTime').textContent = Math.ceil(Math.max(0, mg.t)); }
  function mgFx(h, text) { h.el.querySelector('.fx').textContent = text; h.fxT = 0.5; }
  function whack(i) {
    if (!mg.running) return;
    const h = mg.holes[i];
    const flavor = state.mode === 'fire' ? '🔥' : state.mode === 'ice' ? '❄️' : '';
    if (h.kind === 'mole' || h.kind === 'gold') {
      const pts = h.kind === 'gold' ? 3 : 1;
      mg.score += pts; sfx.quack(); mgFx(h, `${flavor}QUACK! +${pts}`);
    } else if (h.kind === 'duck') {
      mg.score = Math.max(0, mg.score - 2); sfx.bad(); mgFx(h, 'Real duck! −2');
      $('#mgMsg').textContent = pick(['That was an actual duck.', 'The duck has filed a complaint.', 'Officer Bramble is taking notes.']);
    } else { sfx.bonk(); return; }
    h.kind = null; h.el.classList.remove('up');
    updateMgUI();
  }
  function mgUpdate(dt) {
    for (const h of mg.holes) if (h.fxT > 0 && (h.fxT -= dt) <= 0) h.el.querySelector('.fx').textContent = '';
    if (!mg.running) return;
    mg.t -= dt; mg.spawn -= dt;
    const speed = 1 - (30 - mg.t) / 60; // gets faster
    if (mg.spawn <= 0) {
      mg.spawn = (0.45 + Math.random() * 0.4) * speed;
      const empty = mg.holes.filter((h) => !h.kind);
      if (empty.length) {
        const h = pick(empty), r = Math.random();
        h.kind = r < 0.08 ? 'gold' : r < 0.32 ? 'duck' : 'mole';
        h.t = (0.8 + Math.random() * 0.6) * (speed + 0.2);
        h.el.querySelector('.critter').innerHTML = h.kind === 'duck' ? DUCK : MOLE(h.kind === 'gold');
        h.el.classList.add('up');
      }
    }
    for (const h of mg.holes) if (h.kind && (h.t -= dt) <= 0) { h.kind = null; h.el.classList.remove('up'); }
    if (mg.t <= 0) {
      mg.running = false;
      for (const h of mg.holes) { h.kind = null; h.el.classList.remove('up'); }
      state.quackBest = Math.max(state.quackBest, mg.score);
      $('#mgBest').textContent = state.quackBest;
      if (mg.score >= QUACK_GOAL) { $('#mgMsg').textContent = `🏆 ${mg.score} points! The moles quack in respect.`; complete('quack', `Scored ${mg.score}!`); }
      else $('#mgMsg').textContent = `${mg.score} points. Need ${QUACK_GOAL}. The moles are quacking at you.`;
      $('#mgStart').textContent = 'Play again';
      renderQuests();
    }
    updateMgUI();
  }
  $('#mgStart').onclick = startMg;
  $('#mgLeave').onclick = closeMinigame;

  // ============================================================ screens
  function start() {
    audio();
    $('#title').hidden = true; state.screen = 'play';
    toast('☀️ Welcome to the park! Your checklist is top-right. Grandma Rosa is waving at you…');
    shout(grandma, 'Yoo-hoo, dear!', 4);
  }
  function showWin() {
    const mins = Math.floor(state.time / 60), secs = Math.floor(state.time % 60);
    $('#winText').innerHTML = `Biscuit is home, Sam has a friend, the park is (mostly) clean, and the moles have been thoroughly quacked.<br><br>` +
      `⏱ ${mins}m ${secs}s · 🗑️ ${state.garbage} litter · 🌸 ${state.flowersFound} flowers · 🔥 ${state.burntTrees} trees exterminated · 🚓 ${state.arrests} arrest${state.arrests === 1 ? '' : 's'}` +
      (Q.arrest.done ? '' : '<br><br><i>Bonus still open: somebody hasn\'t been arrested yet…</i>');
    $('#win').hidden = false; state.screen = 'win'; clearKeys();
  }
  $('#startBtn').onclick = start;
  $('#winClose').onclick = () => { $('#win').hidden = true; state.screen = 'play'; };
  $('#jailPay').onclick = () => release(true);
  const questsEl = $('#quests');
  function toggleQuests() { questsEl.classList.toggle('open'); }
  $('#questToggle').onclick = toggleQuests;
  if (innerWidth < 700) questsEl.classList.remove('open');

  // ============================================================ input
  function action(k) {
    if (k === 'e' || k === 'enter') interact();
    else if (k === 'q') switchMode();
    else if (k === 'l') litter();
    else if (k === 'j' || k === 'tab') toggleQuests();
    else if (k === 'm') { muted = !muted; toast(muted ? '🔇 Muted' : '🔊 Sound on'); }
  }
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
    if (state.screen === 'title') { if ((k === 'enter' || k === ' ') && !e.repeat) start(); return; }
    if (state.screen === 'win') { if (k === 'enter' || k === 'escape') $('#winClose').click(); return; }
    if (state.screen === 'jail') return;
    if (mg.active) {
      if (/^[1-9]$/.test(k)) whack(+k - 1);
      else if (k === 'escape') closeMinigame();
      else if ((k === 'enter' || k === ' ') && !mg.running && !e.repeat) startMg();
      return;
    }
    if (dialogOpen) {
      if (e.repeat) return;
      if (/^[1-9]$/.test(k)) choose(+k - 1);
      else if (['e', 'enter', ' '].includes(k) && dialogChoices.length === 1) choose(0);
      else if (k === 'escape') { dialogOpen = false; dlg.hidden = true; }
      return;
    }
    keys[k] = true;
    if (!e.repeat) action(k);
  });
  addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
  addEventListener('blur', clearKeys);

  const toWorld = (cx, cy) => ({ x: (cx * dpr) / scale + camX, y: (cy * dpr) / scale + camY });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || state.screen !== 'play' || dialogOpen) return;
    audio();
    const w = toWorld(e.clientX, e.clientY);
    Object.assign(mouse, { held: true, wx: w.x, wy: w.y });
  });
  canvas.addEventListener('pointermove', (e) => { if (mouse.held) { const w = toWorld(e.clientX, e.clientY); mouse.wx = w.x; mouse.wy = w.y; } });
  addEventListener('pointerup', () => { mouse.held = false; });

  // touch joystick + buttons
  const stickEl = $('#stick'), knob = $('#knob');
  let stickId = null;
  function stickMove(e) {
    const r = stickEl.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy), max = r.width / 2;
    if (d > max) { dx *= max / d; dy *= max / d; }
    stick.x = dx / max; stick.y = dy / max;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  stickEl.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stickEl.setPointerCapture(e.pointerId); stickMove(e); audio(); });
  stickEl.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) stickMove(e); });
  const stickEnd = () => { stickId = null; stick.x = stick.y = 0; knob.style.transform = ''; };
  stickEl.addEventListener('pointerup', stickEnd);
  stickEl.addEventListener('pointercancel', stickEnd);
  for (const b of document.querySelectorAll('#tbtns button')) {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); audio();
      if (state.screen !== 'play') return;
      if (dialogOpen) { if (k === 'e' && dialogChoices.length === 1) choose(0); return; }
      if (k === ' ') keys[' '] = true; else action(k);
    });
    b.addEventListener('pointerup', () => { if (k === ' ') keys[' '] = false; });
    b.addEventListener('pointerleave', () => { if (k === ' ') keys[' '] = false; });
  }

  // ============================================================ main loop
  let last = performance.now(), questTick = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (state.screen === 'play' && !dialogOpen) update(dt);
    if (mg.active) mgUpdate(dt);
    if (state.screen === 'jail') {
      state.jailT -= dt;
      $('#jailTime').textContent = Math.max(0, Math.ceil(state.jailT));
      if (state.jailT <= 0) release(false);
    }
    updateFx(dt);
    if ((questTick -= dt) <= 0) { questTick = 0.25; renderQuests(); }
    render();
    requestAnimationFrame(frame);
  }

  buildWorld();
  buildBg();
  resize();
  renderQuests();
  requestAnimationFrame(frame);

  // exposed for automated tests / curious players
  window.__park = { state, Q, player, dog, officer, sam, grandma, keeper, garbage, flowers, bushes, trees, iceP, interact, usePicker, switchMode, litter, whack, mg, startMg, openMinigame, closeMinigame, choose, get dialogOpen() { return dialogOpen; }, get dialogChoices() { return dialogChoices; }, currentTarget };
})();
