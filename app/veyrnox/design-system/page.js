import { Logo } from '../_components/Logo';
import { Main } from '../_components/Main';

const COLORS = [
  { name: 'Base',      hex: '#0A0A0B', token: 'bg-base',    use: 'True-black app background. OLED-dark.' },
  { name: 'Panel',     hex: '#141416', token: 'bg-panel',   use: 'Elevated cards, sheets, inputs.' },
  { name: 'Hairline',  hex: '#26262A', token: 'border',     use: 'All borders and dividers. 1px.' },
  { name: 'Field edge', hex: '#64646A', token: 'field',     use: 'The outline of an input, textarea or select, nothing else. 3:1 on base and panel.' },
  { name: 'Text',      hex: '#F2F2F3', token: 'fg',         use: 'Primary text. Body copy #C9C9CF.' },
  { name: 'Muted',     hex: '#9A9AA3', token: 'fg-muted',   use: 'Secondary text, micro-labels.' },
  { name: 'Aqua',      hex: '#3EE6C4', token: 'accent',     use: 'Actions, selection, live states. Hover #6FF2D8. Ink text #06231F on fills.' },
  { name: 'Amber',     hex: '#E4A93C', token: 'money',      use: 'Credit amounts & money — everywhere, only money.' },
  { name: 'Red',       hex: '#FF5C47', token: 'danger',     use: 'Failure and errors. A refund is credits coming back, so it is not red.' },
  { name: 'Blue',      hex: '#8BA7FF', token: 'warn',       use: 'Warnings and notices, with the △ glyph. Never amber.' },
];

export default function DesignSystem() {
  return (
    <Main className="min-h-dvh max-w-[1300px] mx-auto px-4 sm:px-6 py-10 sm:py-16 pb-24">
      <div className="flex items-center gap-2.5">
        <Logo wordmark />
      </div>
      <h1 className="vx-display vx-title-detail mt-3">Design system v2</h1>
      <p className="text-vx-fg-muted mt-3 max-w-[640px] leading-[1.6]">
        Tokens and components for Veyrnox.ai.
        Rule of the system: <b className="text-vx-accent">aqua does things</b>,{' '}
        <b className="text-vx-money">amber is money</b>.
        Chrome stays monochrome; content thumbnails carry the color.
      </p>
      <div className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-faint mt-3">
        TARGET: NEXT.JS + TAILWIND · WEB 1440 · MOBILE 390 · WCAG 4.5:1 BODY TEXT
      </div>

      {/* 01 COLOR */}
      <Section num="01" title="COLOR TOKENS">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {COLORS.map((c) => (
            <div key={c.name} className="border border-vx-border rounded-2xl overflow-hidden">
              <div className="h-16 border-b border-vx-border" style={{ background: c.hex }} />
              <div className="px-3 py-2.5">
                <div className="text-[13px] font-bold">{c.name}</div>
                <div className="flex justify-between mt-1">
                  <span className="font-vx-mono text-[10.5px] text-vx-fg-muted">{c.hex}</span>
                  <span className="font-vx-mono text-[9px] tracking-[0.08em] text-vx-fg-faint">{c.token}</span>
                </div>
                <div className="text-[11px] text-vx-fg-muted mt-1.5 leading-[1.45]">{c.use}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-6 mt-4 font-vx-mono text-[10px] tracking-[0.1em] text-vx-fg-muted">
          <span>PROHIBITED: LIME / CHARTREUSE FAMILY (#B0FF00–#D8FF80) — ANYWHERE</span>
          <span>AQUA ON BLACK: LARGE TEXT + BUTTONS ONLY · BODY TEXT STAYS NEUTRAL</span>
        </div>
      </Section>

      {/* 02 TYPE */}
      <Section num="02" title="TYPE — ARCHIVO + JETBRAINS MONO">
        <div className="border border-vx-border rounded-2xl p-7 flex flex-col gap-5">
          {/* Page titles come in two sizes and no third (veyrnox.css). */}
          <TypeRow sample="Index title 52 / 76 / 92" klass="vx-display vx-title-index" spec="ARCHIVO 900 · −0.04EM · 0.94 · PRICING, MODELS, TEMPLATES, TOOLS, GUIDES · THE HOME PAGE'S HERO AND CLOSING LINES" />
          <TypeRow sample="Detail title 40 / 56" klass="vx-display vx-title-detail" spec="ARCHIVO 900 · −0.04EM · 0.94 · ONE MODEL, TEMPLATE, GUIDE OR LEGAL PAGE · SECTION HEADINGS" />
          <TypeRow sample="Studio screen title 24–30" klass="text-3xl font-black tracking-[-0.02em]" spec="ARCHIVO 900 · −0.02EM" />
          <TypeRow sample="Card / section title 15–17" klass="text-[17px] font-bold"                        spec="ARCHIVO 700" />
          <TypeRow sample="Body 13–14 / 1.55 — neutral #C9C9CF on black, never aqua" klass="text-[14px] text-vx-fg-body leading-[1.6]" spec="ARCHIVO 500" />
          <TypeRow sample="MICRO-LABEL 10–11 · +0.12EM TRACKING · UPPERCASE" klass="font-vx-mono text-[11px] tracking-[0.12em] text-vx-fg-muted" spec="JETBRAINS MONO 700" />
          <TypeRow sample="−122 cr · 96 / 1,000" klass="font-vx-mono text-[20px] font-bold text-vx-money vx-num" spec="ALL CREDIT NUMERALS + JOB STATES: MONO, TABULAR FIGURES — NON-NEGOTIABLE" />
        </div>
      </Section>

      {/* 03 BUTTONS */}
      <Section num="03" title="BUTTONS — PILL (999PX), COST RIDES THE PRIMARY">
        <div className="border border-vx-border rounded-2xl p-7 flex flex-wrap gap-4 items-center">
          <button className="flex items-center gap-10 bg-vx-accent text-vx-accent-ink rounded-full px-6 py-3.5 font-extrabold hover:bg-vx-accent-hover">
            <span>Generate</span>
            <span className="font-vx-mono text-[13px] font-bold">−16 cr</span>
          </button>
          <button className="bg-vx-money text-vx-money-ink rounded-full px-6 py-3 font-extrabold">Top up · $9</button>
          <button className="bg-transparent border border-vx-border text-vx-fg rounded-full px-6 py-3 font-bold hover:border-vx-accent">Ghost</button>
          <button className="bg-vx-danger text-vx-danger-ink rounded-full px-6 py-3 font-extrabold">Open breaker</button>
          <button disabled className="bg-vx-accent text-vx-accent-ink rounded-full px-6 py-3 font-extrabold opacity-40 cursor-not-allowed">Disabled</button>
        </div>
      </Section>

      {/* 04 CHIPS */}
      <Section num="04" title="CHIPS, BADGES">
        <div className="border border-vx-border rounded-2xl p-7 flex flex-wrap gap-3 items-center">
          <span className="inline-flex items-center font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 border-vx-border text-vx-fg-muted">NEUTRAL</span>
          <span className="inline-flex items-center font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 border-vx-accent/40 text-vx-accent bg-vx-accent/[0.07]">RECOMMENDED</span>
          <span className="inline-flex items-center font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 border-vx-money/40 text-vx-money bg-vx-money/[0.07]">PREMIUM ◆</span>
          <span className="inline-flex items-center font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full px-3 py-1.5 bg-vx-money text-vx-money-ink">MOST PICKED</span>
          <span className="inline-flex items-center font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 border-vx-danger/40 text-vx-danger bg-vx-danger/[0.07]">FAILED · REFUNDED</span>
        </div>
      </Section>

      {/* 05 PRESET CARD */}
      <Section num="05" title="PRESET CARD ANATOMY">
        <div className="border border-vx-border rounded-2xl p-7">
          <div className="max-w-[300px] rounded-2xl border border-vx-border bg-vx-panel overflow-hidden">
            <div className="h-48 relative" style={{ background: 'linear-gradient(135deg,#1b0632,#5a0e6a,#e4318f)' }}>
              <span className="absolute top-3 left-3 inline-flex items-center font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 border-vx-border text-vx-fg-muted bg-black/45 backdrop-blur-sm">CACHED</span>
              <span className="absolute top-3 right-3 font-vx-mono text-[11px] font-bold text-white/85 bg-black/45 backdrop-blur-sm rounded-full px-2.5 py-1 vx-num">▶ 5.8k</span>
            </div>
            <div className="px-4 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-extrabold text-base">NEON ALLEY</div>
                <div className="mt-0.5 text-vx-fg-muted text-xs">Kling 2.6 Pro</div>
              </div>
              <div className="shrink-0 font-vx-mono text-[13px] font-bold text-vx-money vx-num pt-1">22 cr</div>
            </div>
          </div>
          <ul className="mt-5 text-[12px] text-vx-fg-body space-y-1.5">
            <li>• Thumbnail carries the color; chrome (border, text) stays monochrome.</li>
            <li>• Cost lives in mono, tabular, amber — never merges with title weight.</li>
            <li>• Hover: scale-[1.015] over 200ms ease-out.</li>
          </ul>
        </div>
      </Section>

      {/* 06 BALANCE PILL */}
      <Section num="06" title="BALANCE PILL">
        <div className="border border-vx-border rounded-2xl p-7 flex gap-4 items-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-vx-border bg-vx-panel px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-vx-money" />
            <span className="font-vx-mono text-[12px] font-bold text-vx-money vx-num">96 cr</span>
          </span>
          <div className="text-[12px] text-vx-fg-body">
            The counter tick <b className="text-vx-money font-vx-mono vx-num">−16</b> floats up 12px and fades over 1.8s ease-out after a spend.
          </div>
        </div>
      </Section>

      {/* 08 ACCESSIBILITY */}
      <Section num="08" title="ACCESSIBILITY — COLOUR-BLIND SAFE">
        <div className="border border-vx-border rounded-2xl p-7 grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-6">
          <div>
            <div className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">NEVER COLOUR ALONE</div>
            <p className="mt-2 text-[13px] text-vx-fg-body leading-[1.6]">
              Every semantic state carries an unambiguous glyph. Aqua ✓ (action / success),
              amber ◆ (money / premium), red ✕ (failure), blue △ (warning), amber ★ (featured).
              A monochrome print, deutan / protan / tritan vision, or Windows High Contrast
              still separates them.
            </p>
            <ul className="mt-4 space-y-2 text-[13px] text-vx-fg-body">
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> Body text at #C9C9CF on #0A0A0B — 12.6:1, AAA</li>
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> Aqua on black only for large text / buttons / chart edges</li>
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> Amber reserved for money / premium — same rule, same glyph</li>
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> Red used only with ✕ glyph and a text label</li>
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> Focus ring 2px aqua, offset 2px, on every interactive element</li>
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> <code>prefers-contrast: more</code> boosts hairlines and mutes</li>
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> <code>prefers-reduced-motion</code> kills every animation</li>
            </ul>
          </div>
          <div>
            <div className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted mb-3">STATE CHIPS · WITH GLYPH</div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 border-vx-accent/40 text-vx-accent bg-vx-accent/[0.07]">
                <span aria-hidden="true">✓</span>DONE
              </span>
              <span className="inline-flex items-center gap-1.5 font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 border-vx-accent/40 text-vx-accent bg-vx-accent/[0.07]">
                <span aria-hidden="true">●</span>RUNNING
              </span>
              <span className="inline-flex items-center gap-1.5 font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 border-vx-danger/40 text-vx-danger bg-vx-danger/[0.07]">
                <span aria-hidden="true">✕</span>FAILED · REFUNDED
              </span>
              <span className="inline-flex items-center gap-1.5 font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 border-vx-money/40 text-vx-money bg-vx-money/[0.07]">
                <span aria-hidden="true">◆</span>PREMIUM
              </span>
              <span className="inline-flex items-center gap-1.5 font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 border-vx-warn/40 text-vx-warn bg-vx-warn/[0.07]">
                <span aria-hidden="true">△</span>ATTENTION
              </span>
              <span className="inline-flex items-center gap-1.5 font-vx-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full px-3 py-1.5 bg-vx-money text-vx-money-ink">
                <span aria-hidden="true">★</span>MOST PICKED
              </span>
            </div>
            <div className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-faint mt-6">
              PROHIBITED — RED / GREEN AS ONLY DIFFERENTIATOR · AQUA-ON-BLACK BODY TEXT · LIME (#B0FF00–#D8FF80)
            </div>
          </div>
        </div>
      </Section>

      {/* 07 SHAPE MOTION */}
      <Section num="07" title="SHAPE, MOTION">
        <div className="border border-vx-border rounded-2xl p-7 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">RADII</div>
            <ul className="mt-2 text-[13px] text-vx-fg-body space-y-1">
              <li>Cards · 12–16px</li>
              <li>Inputs · 8px</li>
              <li>Buttons + chips · 999px (pill)</li>
              <li>Admin panels · 10px (denser)</li>
              <li>Hairlines · 1px #26262A</li>
            </ul>
          </div>
          <div>
            <div className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">MOTION</div>
            <ul className="mt-2 text-[13px] text-vx-fg-body space-y-1">
              <li>Hover / selection · 150–200ms ease-out</li>
              <li>Generating shimmer · 1.6s linear infinite</li>
              <li>Balance tick · 1.8s ease-out</li>
              <li>Bottom sheets · slide-up 280ms ease-out</li>
              <li>Overlays · fade 200ms</li>
              <li><b>Always respect</b> prefers-reduced-motion</li>
            </ul>
          </div>
        </div>
      </Section>

      {/* 09 RECEIPT SLIP */}
      <Section num="09" title="RECEIPT SLIP — THE ONE MATERIAL">
        <div className="border border-vx-border rounded-2xl p-7 grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-8 items-start">
          <div className="vx-paper-shadow max-w-[420px]">
            <div className="vx-paper px-6 pt-9 pb-10">
              <div className="text-[13px] font-bold">Current balance</div>
              <div className="mt-2 font-vx-mono text-[48px] font-bold text-vx-money leading-none vx-num">
                96<span className="text-xl align-middle ml-2 text-vx-fg-muted">cr</span>
              </div>
              <div className="vx-perf mt-6" aria-hidden />
              <div className="mt-4 flex items-baseline gap-2 font-vx-mono text-[13px] vx-num">
                <span>Text to video, 5s</span>
                <span aria-hidden className="vx-leader flex-1" />
                <span className="font-bold text-vx-money">−22 cr</span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-2 font-vx-mono text-[13px] vx-num">
                <span className="font-bold text-vx-accent">Refund</span>
                <span aria-hidden className="vx-leader flex-1" />
                <span className="font-bold text-vx-accent">+22 cr</span>
              </div>
            </div>
          </div>
          <div>
            <div className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">HOW IT IS BUILT</div>
            <ul className="mt-2 text-[13px] text-vx-fg-body space-y-1.5 leading-[1.6]">
              <li><code>.vx-paper</code> re-points the colour tokens at a paper palette and tears the top and bottom edge. Any component works inside it unchanged, in both themes.</li>
              <li><code>.vx-paper-shadow</code> goes on a wrapper: the torn-edge mask would clip a shadow on the slip itself.</li>
              <li><code>.vx-leader</code> is the dotted line between an item and its price. <code>.vx-perf</code> is the perforation rule.</li>
              <li>Prices set in mono, in the paper amber (#8A5A00). A refund is aqua. Everything else stays in Archivo.</li>
              <li>Used for the balance on Credits, Credit Packs on Pricing, the price slip on the home page and the footer statement.</li>
            </ul>
          </div>
        </div>
      </Section>
    </Main>
  );
}

function Section({ num, title, children }) {
  return (
    <section className="mt-14">
      <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent mb-4">
        {num} · {title}
      </div>
      {children}
    </section>
  );
}

function TypeRow({ sample, klass, spec }) {
  return (
    <div className="flex items-baseline gap-6 flex-wrap">
      <span className={klass}>{sample}</span>
      <span className="font-vx-mono text-[10px] text-vx-fg-faint">{spec}</span>
    </div>
  );
}
