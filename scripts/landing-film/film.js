// The film's timeline. seek(t) sets every style from the clock and nothing
// else, so frame 400 looks the same whether or not frames 0 to 399 ran.

(() => {
  const { clamp, lerp, seg, easeOut, easeIn, easeInOut, spring, track, mixRgb, setRise, cursorAt } = window.Film;
  const S = window.FilmScene;
  const { T, P } = S;
  let M; // text measurements, taken once the fonts are in

  const CAM = { f: 1.5, z: 1 };
  const WHIP = { f: 2.4, z: 1 };
  const SOFT = { f: 2.6, z: 0.9 };
  const SHUT = { f: 3, z: 1 };
  const POP = { f: 4, z: 0.7 };
  const AQUA = [62, 230, 196];
  const PANEL = [20, 20, 22];
  const BODY = [201, 201, 207];
  const BASE = [10, 10, 11];
  const BORDER = [62, 62, 68];
  const FG = [242, 242, 243];
  const CLICKS = [...T.pick, T.press];
  const LIST_ZOOM = 1.1;
  // The chip each click lands on: Kling, Nano Banana, back to Wan.
  const PICKED = [1, 2, 0];

  /** A box drawn from its centre, with its left and right halves free to differ. */
  function setBox(node, { x, y, left, right, h, r, scale = 1, bg }) {
    const w = Math.max(0, left + right);
    const height = Math.max(0, h);
    node.style.width = `${w}px`;
    node.style.height = `${height}px`;
    node.style.borderRadius = `${Math.min(r, height / 2, w / 2)}px`;
    node.style.transform = `translate(${x - left}px, ${y - height / 2}px) scale(${scale})`;
    node.style.background = bg;
  }

  /** How much of the price list has fed out, 0..1. */
  function feed(t) {
    const p = seg(t, T.feed[0], T.feed[1]);
    return p * p * (3 - 2 * p);
  }

  function camera(t) {
    const x = track(t, P.button.x, [[T.morph, 2810, CAM], [T.list, P.end.x, CAM]]);
    // While the price list prints, the camera follows the paper's bottom edge.
    const listEnd = P.slip.y + M.paperFull - (540 / LIST_ZOOM - 70);
    const y = track(t, P.button.y, [[T.pullBack, 540, CAM], [T.chips + 0.4, 600, CAM], [T.morph, 540, CAM], [T.list, 760, CAM]])
      + (listEnd - 760) * feed(t)
      + (P.end.y - listEnd) * spring(t, T.end, WHIP)
      + (P.end.button - P.end.y) * spring(t, T.out, WHIP);
    const s = track(t, 1.9, [
      [T.pullBack, 1, CAM], [T.chips + 0.4, 1.1, CAM], [T.morph, 1, CAM],
      [T.list, LIST_ZOOM, CAM], [T.end, 1, WHIP], [T.out, 1.9, WHIP],
    ]);
    S.world.style.transform = `translate(${960 - x * s}px, ${540 - y * s}px) scale(${s})`;
  }

  function chips(t) {
    const FAST = { f: 4.2, z: 0.82 };
    const SLOW = { f: 3, z: 0.9 };
    const rects = M.chipRects;
    const edge = (side) => (i) => rects[i].left + (side === 'right' ? rects[i].width : 0);
    // The edge facing the direction of travel leads; the other one trails,
    // so the pill stretches as it goes.
    const steps = (side) => T.pick.map((at, i) => {
      const goingRight = PICKED[i] > (i ? PICKED[i - 1] : 0);
      return [at, edge(side)(PICKED[i]), (side === 'right') === goingRight ? FAST : SLOW];
    });
    const left = track(t, edge('left')(0), steps('left'));
    const right = track(t, edge('right')(0), steps('right'));
    S.chipInd.style.left = `${left}px`;
    S.chipInd.style.width = `${right - left}px`;
    S.chipInd.style.transform = `scale(${spring(t, T.chips, POP)})`;
    const centre = (left + right) / 2;
    S.chips.forEach((chip, i) => {
      const on = clamp(1 - Math.abs(centre - (rects[i].left + rects[i].width / 2)) / (rects[i].width * 0.55));
      chip.style.color = mixRgb(BODY, BASE, on);
      chip.style.borderColor = mixRgb(BORDER, FG, on);
      chip.style.transform = `scale(${spring(t, T.chips + i * 0.06, POP)})`;
    });
  }

  /** A job card's own clock: progress, then Done. */
  function job(tile, t, { gen, settledAt }) {
    const p = easeInOut(seg(t, gen[0], gen[1]));
    const settled = easeOut(seg(t, settledAt, settledAt + 0.3));
    tile.bar.style.width = `${p * 100}%`;
    tile.pct.textContent = `${Math.round(p * 100)}%`;
    tile.pct.style.transform = `translateY(${-settled * 110}%)`;
    tile.stateRoll(t);
    tile.costRoll(t);
    tile.badge.style.transform = `scale(${spring(t, settledAt, { f: 4, z: 0.6 })})`;
    // The studio's own loading shimmer, while the job runs.
    tile.shine.style.transform = `translateX(${(((t - gen[0]) / 1.1) % 1) * 200 - 100}%)`;
    tile.shine.style.opacity = t > gen[0] ? 1 - settled : 0;
    // A slow drift of the gradient: an abstract stand-in, not model output.
    tile.media.style.backgroundPosition = `${50 + 32 * Math.sin(t * 0.8)}% ${50 + 32 * Math.cos(t * 0.6)}%`;
    tile.media.style.opacity = lerp(0.3, 1, spring(t, settledAt, { f: 2.5, z: 1 }));
  }

  // One box all the way: a dot, the button, job 1, then its thumbnail.
  function hero(t) {
    const MORPH = { f: 2.4, z: 0.85 };
    const TRAVEL = { f: 1.9, z: 0.95 };
    const right = track(t, 12, [[T.stretch, 280, { f: 3.4, z: 0.72 }], [T.morph, 360, MORPH], [T.job2, 168, SOFT], [T.clear, 0, SHUT]]);
    const left = track(t, 12, [[T.stretch + 0.06, 280, { f: 3, z: 0.8 }], [T.morph + 0.04, 360, MORPH], [T.job2, 168, SOFT], [T.clear, 0, SHUT]]);
    const h = track(t, 24, [[T.stretch, 96, { f: 3.2, z: 0.8 }], [T.morph, 405, MORPH], [T.job2, 189, SOFT], [T.clear, 0, SHUT]]);
    const x = track(t, P.button.x, [[T.morph, P.tile.x, TRAVEL], [T.job2, P.thumb.x, SOFT]]);
    const y = track(t, P.button.y, [[T.morph, P.tile.y, TRAVEL], [T.job2, P.thumb.y, SOFT]]);
    const r = track(t, 48, [[T.stretch + 0.1, 22, SHUT], [T.morph, 30, CAM], [T.job2, 16, CAM]]);
    const pressed = spring(t, T.press, { f: 9, z: 1 }) - spring(t, T.morph, { f: 5, z: 0.6 });
    const scale = spring(t, T.dot, { f: 5, z: 0.55 }) * (1 - 0.05 * pressed);
    const toTile = seg(t, T.morph, T.morph + 0.3);
    setBox(S.hero, { x, y, left, right, h, r, scale, bg: mixRgb(AQUA, PANEL, toTile) });

    setRise(S.heroFace.label, easeOut(seg(t, T.label, T.label + 0.4)));
    S.heroFace.price(t);
    S.heroFace.node.style.opacity = 1 - toTile;
    S.heroFace.node.style.filter = toTile > 0 ? `blur(${toTile * 10}px)` : '';
    S.job1.node.style.transform = `scale(${(left + right) / 720})`;
    S.job1.node.style.opacity = seg(t, T.morph + 0.12, T.morph + 0.4);
    job(S.job1, t, { gen: T.gen1, settledAt: T.done1 });
  }

  function job2(t) {
    const out = spring(t, T.job2, { f: 2.6, z: 0.8 });
    const gone = spring(t, T.clear + 0.06, SHUT);
    setBox(S.job2Box, {
      x: lerp(P.thumb.x, P.tile.x, out), y: lerp(P.thumb.y, P.tile.y, out),
      left: 360, right: 360, h: 405, r: 30, scale: Math.max(0, out) * (1 - gone), bg: mixRgb(PANEL, PANEL, 0),
    });
    job(S.job2, t, { gen: T.gen2, settledAt: T.done2 });
  }

  // The statement prints a line per job, then feeds out the price list.
  function slip(t) {
    const PRINT = { f: 3, z: 0.9 };
    const out = track(t, 0, [[T.line1, M.reveal[0], PRINT], [T.line2, M.reveal[1], PRINT]]);
    S.slot.style.transform = `scaleX(${spring(t, T.slot, { f: 4, z: 0.8 })})`;
    S.paper.style.height = `${Math.max(0, out + (M.paperFull - M.reveal[1]) * feed(t))}px`;
  }

  function cursor(t) {
    const y = P.chipsY + 10;
    const c = M.chipCentres;
    const stops = [
      [2.2, 1560, 1280],
      ...T.pick.map((at, i) => [at - 0.05, c[PICKED[i]] + 20, y]),
      [T.press - 0.15, P.button.x + 120, P.button.y + 10],
      [T.morph + 0.9, 1700, 1300],
    ];
    const at = cursorAt(t, stops);
    const dip = CLICKS.reduce((n, click) => n + spring(t, click - 0.02, { f: 12, z: 1 }) - spring(t, click + 0.1, { f: 7, z: 0.8 }), 0);
    S.cursor.style.transform = `translate(${at.x}px, ${at.y}px) scale(${1 - 0.18 * dip})`;
  }

  // The end card builds the opening shot again, then folds back into the dot
  // so the last frame is the first one.
  function endCard(t) {
    const a = T.end + 0.15;
    const SHRINK = { f: 3.2, z: 1 };
    const half = track(t, 12, [[a + 0.15, 280, { f: 3.4, z: 0.72 }], [T.out + 0.05, 12, SHRINK]]);
    const h = track(t, 24, [[a + 0.15, 96, { f: 3.2, z: 0.8 }], [T.out + 0.05, 24, SHRINK]]);
    const r = track(t, 48, [[a + 0.25, 22, SHUT], [T.out + 0.05, 48, SHUT]]);
    const scale = spring(t, a, { f: 5, z: 0.55 }) * (1 - easeIn(seg(t, T.total - 0.16, T.total - 0.02)));
    setBox(S.endBox, { x: P.end.x, y: P.end.button, left: half, right: half, h, r, scale, bg: mixRgb(AQUA, AQUA, 0) });
    setRise(S.endFace.label, easeOut(seg(t, a + 0.4, a + 0.75)));
    S.endFace.price(t);
    S.endFace.node.style.opacity = 1 - seg(t, T.out - 0.05, T.out + 0.1);
    S.endWords.forEach((word, i) => {
      const at = a + 0.08 + i * 0.05;
      setRise(word, easeOut(seg(t, at, at + 0.4)), easeIn(seg(t, T.out - 0.32 + i * 0.015, T.out - 0.08 + i * 0.015)));
    });
    const brand = spring(t, a + 0.3, POP) * (1 - easeIn(seg(t, T.out - 0.34, T.out - 0.14)));
    S.brand.style.transform = `translateX(-50%) scale(${brand})`;
  }

  function seek(t) {
    camera(t);
    S.words.forEach((word, i) => {
      const at = T.pullBack + i * 0.1 + (i > 2 ? 0.08 : 0);
      setRise(word, easeOut(seg(t, at, at + 0.45)));
    });
    chips(t);
    S.failLine.style.clipPath = `inset(0 ${100 - 100 * easeOut(seg(t, T.chips + 0.2, T.chips + 0.6))}% 0 0)`;
    S.failRoll(t);
    hero(t);
    job2(t);
    slip(t);
    S.captionWords.forEach((word, i) => {
      const at = T.caption + i * 0.07;
      setRise(word, easeOut(seg(t, at, at + 0.4)), easeIn(seg(t, T.clear - 0.14 + i * 0.02, T.clear + 0.12 + i * 0.02)));
    });
    S.typeWords.forEach((word, i) => setRise(word, easeOut(seg(t, T.words[i], T.words[i] + 0.4))));
    S.balanceWords.forEach((word, i) => setRise(word, easeOut(seg(t, T.words[3] + i * 0.07, T.words[3] + 0.4 + i * 0.07))));
    endCard(t);
    cursor(t);
  }

  const FONTS = ['900 10px Archivo', '800 10px Archivo', '600 10px Inter', '700 10px "JetBrains Mono"'];
  window.duration = T.total;
  window.blurWindows = S.BLUR;
  window.seek = seek;
  window.ready = Promise.all(FONTS.map((font) => document.fonts.load(font))).then(() => {
    M = S.measure();
    const at = new URLSearchParams(window.location.search).get('t');
    if (at !== null) { seek(Number(at) || 0); return; }
    // No ?t: play it in real time, for scrubbing by eye.
    const play = (now) => { seek((now / 1000) % T.total); window.requestAnimationFrame(play); };
    window.requestAnimationFrame(play);
  });
})();
