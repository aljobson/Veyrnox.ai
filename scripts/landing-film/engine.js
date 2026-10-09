// Time-pure helpers for the landing film. Every style is a function of t:
// no CSS transitions, no timers, nothing carried between frames, so any
// frame can be rendered on its own and the render is repeatable.
// Loaded as a classic script (film.html opens from file://, where module
// scripts are blocked), so it hangs its helpers on one global.

(() => {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  /** 0 before a, 1 after b, linear between. */
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const easeOut = (p) => 1 - (1 - p) ** 4;
  const easeIn = (p) => p ** 3;
  const easeInOut = (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);

  /** Closed-form step response of a damped spring: 0 until t0, settles at 1. */
  function spring(t, t0, { f = 3, z = 0.8 } = {}) {
    const x = t - t0;
    if (x <= 0) return 0;
    const w = 2 * Math.PI * f;
    if (z >= 1) return 1 - Math.exp(-w * x) * (1 + w * x);
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * x) * (Math.cos(wd * x) + ((z * w) / wd) * Math.sin(wd * x));
  }

  /**
   * A value that changes target many times: one spring per change, summed,
   * so it stays a pure function of time. steps: [[t0, target, springOpts]].
   */
  function track(t, start, steps) {
    let value = start;
    let previous = start;
    for (const [t0, target, opts] of steps) {
      value += (target - previous) * spring(t, t0, opts);
      previous = target;
    }
    return value;
  }

  const mixRgb = (a, b, p) => `rgb(${a.map((c, i) => Math.round(lerp(c, b[i], p))).join(',')})`;

  function el(parent, tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  /** Words that rise out of a mask line. Returns the inner spans to move. */
  function riseWords(parent, text, className = '') {
    return text.split(' ').map((word) => {
      const mask = el(parent, 'span', `mask ${className}`);
      return el(mask, 'span', 'rise', word);
    });
  }

  // Far enough that a hidden word clears the mask's padding as well.
  const RISE = 165;

  /** p 0..1 rises into place; out 0..1 keeps rising, out through the top. */
  function setRise(node, p, out = 0) {
    node.style.transform = `translateY(${(1 - p) * RISE - out * RISE}%)`;
  }

  /**
   * A figure that rolls to a new value: the old one leaves upward as the new
   * one arrives from below. changes: [[time, text, color?]]; the first is the
   * entrance. The box is a one-cell grid, so it is as wide as its widest value.
   */
  function roller(parent, changes, className = '') {
    const box = el(parent, 'span', `roller ${className}`);
    const spans = changes.map(([, text, color]) => {
      const span = el(box, 'span', 'roll', text);
      if (color) span.style.color = color;
      return span;
    });
    const ROLL = 0.3;
    return (t) => {
      spans.forEach((span, i) => {
        const inP = easeOut(seg(t, changes[i][0], changes[i][0] + ROLL));
        const next = changes[i + 1];
        const outP = next ? easeOut(seg(t, next[0], next[0] + ROLL)) : 0;
        span.style.transform = `translateY(${(1 - inP) * 110 - outP * 110}%)`;
        span.style.opacity = inP > 0 && outP < 1 ? 1 : 0;
      });
    };
  }

  /**
   * Cursor position from waypoints [[arriveAt, x, y]]: it rests on a waypoint
   * and makes each move in the last `travel` seconds before the next one.
   */
  function cursorAt(t, points, travel = 0.42) {
    let [, x, y] = points[0];
    for (let i = 1; i < points.length; i += 1) {
      const [arrive, nx, ny] = points[i];
      const p = easeInOut(seg(t, arrive - travel, arrive));
      x = lerp(x, nx, p);
      y = lerp(y, ny, p);
    }
    return { x, y };
  }

  window.Film = { clamp, lerp, seg, easeOut, easeIn, easeInOut, spring, track, mixRgb, el, riseWords, setRise, roller, cursorAt };
})();
