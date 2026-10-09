// Builds the film's DOM once and measures it. Nothing here moves: film.js
// reads these nodes and sets their styles from the clock.

(() => {
  const { el, riseWords, roller } = window.Film;
  const world = document.getElementById('world');

  // prices.js holds every figure the film shows, keyed by catalog id.
  const PRICE_LIST = window.FilmPrices;
  const creditsOf = (id) => PRICE_LIST.flatMap(([, rows]) => rows).find((model) => model.id === id).credits;
  const PRICE = { wan: creditsOf('wan-2.5-kie'), kling: creditsOf('kling-2.6-pro-kie'), banana: creditsOf('nano-banana-kie') };

  // The clock, in seconds. 120 BPM: a beat is 0.5 s and most cues sit on one.
  const T = {
    dot: 0.1, stretch: 0.5, label: 0.85, price: 1.0, pullBack: 1.5,
    chips: 2.5, pick: [3.0, 3.5, 4.0], press: 5.0, morph: 5.12,
    slot: 5.2, line1: 5.3, gen1: [5.45, 6.4], done1: 6.5,
    job2: 7.0, line2: 7.12, gen2: [7.3, 7.9], done2: 8.0, caption: 8.5,
    clear: 10.0, list: 10.1, feed: [10.2, 12.0], words: [10.5, 10.75, 11.0, 11.5],
    end: 12.4, out: 14.45, total: 15,
  };

  // The stretches where something crosses the frame fast enough to strobe
  // at 60 frames a second. render.mjs blurs these and leaves the rest sharp.
  const BLUR = [
    [T.stretch, T.stretch + 0.4], [T.pullBack, T.pullBack + 0.5], [T.morph - 0.02, T.morph + 0.7],
    [T.job2, T.job2 + 0.4], [T.clear, T.list + 0.6],
    [T.end, T.end + 0.8], [T.out - 0.05, T.total],
  ];

  // World positions. The camera travels: A is the button, B the jobs and the
  // statement, C the price list (the same slip, further down), D the end card.
  const P = {
    button: { x: 960, y: 745 }, chipsY: 590, headlineY: 185,
    tile: { x: 2440, y: 640 }, thumb: { x: 2248, y: 290 },
    slip: { x: 2880, y: 300 }, caption: { x: 2880, y: 690 }, type: { x: 2150, y: 860 },
    end: { x: 2842, y: 2300, button: 2500, headline: 2090, brand: 2010 },
  };

  const svg = (parent, className, viewBox, body) => {
    const node = el(parent, 'div', className);
    // Only ever the constant drawings below: no outside text reaches this.
    node.innerHTML = `<svg viewBox="${viewBox}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
    return node;
  };
  const place = (node, x, y) => { node.style.left = `${x}px`; node.style.top = `${y}px`; return node; };
  const priceTimes = [T.price, ...T.pick.map((at) => at + 0.03)];
  const priceSteps = [PRICE.wan, PRICE.kling, PRICE.banana, PRICE.wan];

  /** Headline in two centred lines; returns the word spans in reading order. */
  function headline(x, y) {
    const box = place(el(world, 'div', 'display center'), x, y);
    box.style.fontSize = '132px';
    return ['The price is', 'on the button.'].flatMap((line) => riseWords(el(box, 'div'), line));
  }

  /** The Generate button's face: a label and the price that rolls. */
  function face(parent, changes) {
    const node = el(parent, 'div', 'face');
    const label = riseWords(el(node, 'span', 'label'), 'Generate')[0];
    return { node, label, price: roller(node, changes, 'mono price') };
  }

  /** A job card: what the button becomes once it is pressed. */
  function tile(parent, { name, gradient, cost, state }) {
    const node = el(parent, 'div', 'tile');
    const media = el(node, 'div', 'media');
    media.style.backgroundImage = gradient;
    el(node, 'div', 'scrim');
    const shine = el(node, 'div', 'shine');
    el(node, 'div', 'name', name);
    const costRoll = roller(el(node, 'div', 'cost mono'), cost);
    const pct = el(el(node, 'div', 'pct mono'), 'div');
    const stateRoll = roller(el(node, 'div', 'state'), [state], 'left');
    const bar = el(node, 'div', 'bar');
    const badge = svg(node, 'badge', '0 0 76 76', CHECK);
    return { node, media, shine, costRoll, pct, stateRoll, bar, badge };
  }

  const CHECK = '<circle cx="38" cy="38" r="38" fill="rgb(62,230,196)"/><path d="M22 39 L33 50 L55 27" fill="none" stroke="rgb(6,35,31)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>';
  const MARK = '<path d="M8 12 L38 12 L60 62 L82 12 L112 12 L60 112 Z" fill="rgb(62,230,196)"/>';

  /** One line of the statement: label, dotted leader, amount. */
  function row(sheet, label, amount) {
    const node = el(sheet, 'div', 'srow mono');
    el(node, 'span', '', label);
    el(node, 'span', 'leader');
    el(node, 'span', 'amount', amount);
    return node;
  }

  // ── A: the button, its headline and the model chips ──
  const words = headline(P.button.x, P.headlineY);
  const chipBox = place(el(world, 'div', 'chips'), P.button.x, P.chipsY - 32);
  const chipInd = el(chipBox, 'div', 'chip-ind');
  const chips = ['Wan 2.5', 'Kling 2.6 Pro', 'Nano Banana'].map((name) => el(chipBox, 'div', 'chip', name));
  const failLine = place(el(world, 'div', 'failline mono'), P.button.x - 280, P.button.y + 86);
  el(failLine, 'span', '', 'If it fails');
  el(failLine, 'span', 'leader');
  const failRoll = roller(failLine, priceSteps.map((n, i) => [i ? priceTimes[i] : T.chips + 0.25, `${n} cr back`]));

  // The hero box: a dot, then the button, then job 1, then its thumbnail.
  const hero = el(world, 'div', 'box');
  const heroFace = face(hero, priceSteps.map((n, i) => [priceTimes[i], `${n} cr`]));
  const job1 = tile(hero, {
    name: 'Wan 2.5 · 5 s clip',
    gradient: 'linear-gradient(135deg,#0a1a2c 0%,#144a7a 55%,#3ec1e8 100%)',
    cost: [[T.line1, `−${PRICE.wan} cr`, 'var(--money)']],
    state: [T.done1, 'Done'],
  });

  // ── B: a second job, and the statement that records both ──
  const job2Box = el(world, 'div', 'box');
  const job2 = tile(job2Box, {
    name: 'Nano Banana · one image',
    gradient: 'linear-gradient(160deg,#2b1a0a 0%,#7a4a1e 60%,#f0b060 100%)',
    cost: [[T.line2, `−${PRICE.banana} cr`, 'var(--money)']],
    state: [T.done2, 'Done'],
  });
  const caption = place(el(world, 'div', 'display'), P.caption.x, P.caption.y);
  caption.style.fontSize = '76px';
  const captionWords = ['Every credit', 'leaves a line.'].flatMap((line) => riseWords(el(caption, 'div'), line));

  const slot = place(el(world, 'div', 'slot'), P.slip.x - 20, P.slip.y - 7);
  const paperShadow = place(el(world, 'div', 'paper-shadow'), P.slip.x, P.slip.y);
  const paper = el(paperShadow, 'div', 'paper');
  const sheet = el(paper, 'div', 'sheet');
  const head = el(sheet, 'div', 'srow head');
  el(head, 'span', '', 'Credit statement');
  el(head, 'span', 'note', 'Example');
  el(sheet, 'div', 'perf');
  const lines = [
    row(sheet, 'Wan 2.5, 5 s clip', `−${PRICE.wan}`),
    row(sheet, 'Nano Banana, one image', `−${PRICE.banana}`),
  ];
  // ── C: the same slip keeps printing, and becomes the price list ──
  el(sheet, 'div', 'perf');
  el(el(sheet, 'div', 'srow head'), 'span', '', 'The price list');
  PRICE_LIST.forEach(([group, rows]) => {
    el(sheet, 'div', 'srow group', group);
    rows.forEach(({ name, credits }) => row(sheet, name, `${credits} cr`));
  });

  const type = place(el(world, 'div', 'display'), P.type.x, P.type.y);
  type.style.fontSize = '140px';
  type.style.lineHeight = '1';
  const typeWords = ['Image.', 'Video.', 'Audio.'].map((word) => riseWords(el(type, 'div'), word)[0]);
  const balance = el(type, 'div', 'accent');
  balance.style.cssText = 'font-size:70px;margin-top:38px';
  const balanceWords = riseWords(balance, 'One credit balance.');

  // ── D: the end card ──
  const brand = place(el(world, 'div', 'brand'), P.end.x, P.end.brand);
  svg(brand, '', '0 0 120 120', MARK).style.cssText = 'width:54px;height:54px';
  el(brand, 'span', '', 'VEYRNOX');
  el(brand, 'span', 'accent', '.ai').style.marginLeft = '-16px';
  const endWords = headline(P.end.x, P.end.headline);
  const endBox = el(world, 'div', 'box');
  const endFace = face(endBox, [[T.end + 0.6, `${PRICE.wan} cr`]]);

  const cursor = svg(world, 'cursor', '0 0 44 44', '<path d="M4 3 L4 33 L12 25.5 L17.5 38 L23 35.6 L17.6 23.6 L28.5 23 Z" fill="rgb(242,242,243)" stroke="rgb(10,10,11)" stroke-width="2.5" stroke-linejoin="round"/>');

  // Measured once fonts are in, so the timeline never guesses a text width.
  function measure() {
    const chipRects = chips.map((chip) => ({ left: chip.offsetLeft, width: chip.offsetWidth }));
    const boxLeft = P.button.x - chipBox.offsetWidth / 2;
    // Paper past a line's bottom edge: enough for the torn teeth, not
    // enough to show the top of the line that has not printed yet.
    const pad = 8;
    return {
      chipRects,
      chipCentres: chipRects.map((r) => boxLeft + r.left + r.width / 2),
      // How much paper is out once each statement line has printed.
      reveal: lines.map((line) => line.offsetTop + line.offsetHeight + pad),
      paperFull: sheet.offsetHeight + 36,
    };
  }

  window.FilmScene = {
    T, P, BLUR, world, measure,
    words, chips, chipInd, failLine, failRoll, hero, heroFace, job1,
    job2Box, job2, caption, captionWords, slot, paper,
    typeWords, balanceWords, brand, endWords, endBox, endFace, cursor,
  };
})();
