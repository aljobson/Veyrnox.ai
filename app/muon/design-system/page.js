import { Logo } from '../_components/Logo';

const COLORS = [
  { name: 'Base',      hex: '#0A0A0B', token: 'bg-base',    use: 'True-black app background. OLED-dark.' },
  { name: 'Panel',     hex: '#141416', token: 'bg-panel',   use: 'Elevated cards, sheets, inputs.' },
  { name: 'Hairline',  hex: '#26262A', token: 'border',     use: 'All borders and dividers. 1px.' },
  { name: 'Text',      hex: '#F2F2F3', token: 'fg',         use: 'Primary text. Body copy #C9C9CF.' },
  { name: 'Muted',     hex: '#9A9AA3', token: 'fg-muted',   use: 'Secondary text, micro-labels.' },
  { name: 'Aqua',      hex: '#3EE6C4', token: 'accent',     use: 'Actions, selection, live states. Hover #6FF2D8. Ink text #06231F on fills.' },
  { name: 'Amber',     hex: '#E4A93C', token: 'money',      use: 'Credit amounts & money — everywhere, only money.' },
  { name: 'Red',       hex: '#FF5C47', token: 'danger',     use: 'Failure, refunds, open breakers.' },
];

export default function DesignSystem() {
  return (
    <div className="min-h-dvh px-14 py-16 pb-24 max-w-[1200px] mx-auto">
      <div className="flex items-center gap-2.5">
        <Logo />
        <span className="font-extrabold text-[15px] tracking-[0.18em]">MUON</span>
      </div>
      <h1 className="text-[48px] font-black tracking-[-0.03em] leading-[1.05] mt-3">Design system v2</h1>
      <p className="text-muon-fg-muted mt-3 max-w-[640px] leading-[1.6]">
        Tokens and components for the Higgsfield-genre restyle.
        Rule of the system: <b className="text-muon-accent">aqua does things</b>,{' '}
        <b className="text-muon-money">amber is money</b>.
        Chrome stays monochrome; content thumbnails carry the color.
      </p>
      <div className="font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-faint mt-3">
        TARGET: NEXT.JS + TAILWIND · WEB 1440 · MOBILE 390 · WCAG 4.5:1 BODY TEXT
      </div>

      {/* 01 COLOR */}
      <Section num="01" title="COLOR TOKENS">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {COLORS.map((c) => (
            <div key={c.name} className="border border-muon-border rounded-2xl overflow-hidden">
              <div className="h-16 border-b border-muon-border" style={{ background: c.hex }} />
              <div className="px-3 py-2.5">
                <div className="text-[13px] font-bold">{c.name}</div>
                <div className="flex justify-between mt-1">
                  <span className="font-muon-mono text-[10.5px] text-muon-fg-muted">{c.hex}</span>
                  <span className="font-muon-mono text-[9px] tracking-[0.08em] text-muon-fg-faint">{c.token}</span>
                </div>
                <div className="text-[11px] text-muon-fg-muted mt-1.5 leading-[1.45]">{c.use}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-6 mt-4 font-muon-mono text-[10px] tracking-[0.1em] text-muon-fg-muted">
          <span>PROHIBITED: LIME / CHARTREUSE FAMILY (#B0FF00–#D8FF80) — ANYWHERE</span>
          <span>AQUA ON BLACK: LARGE TEXT + BUTTONS ONLY · BODY TEXT STAYS NEUTRAL</span>
        </div>
      </Section>

      {/* 02 TYPE */}
      <Section num="02" title="TYPE — ARCHIVO + JETBRAINS MONO">
        <div className="border border-muon-border rounded-2xl p-7 flex flex-col gap-5">
          <TypeRow sample="Hero 64–72"      klass="text-[64px] font-black tracking-[-0.035em] leading-none" spec="ARCHIVO 900 · −0.035EM · SENTENCE CASE" />
          <TypeRow sample="Screen title 28–32" klass="text-[30px] font-extrabold tracking-[-0.02em]"        spec="ARCHIVO 800 · −0.02EM" />
          <TypeRow sample="Card / section title 15–17" klass="text-[17px] font-bold"                        spec="ARCHIVO 700" />
          <TypeRow sample="Body 13–14 / 1.55 — neutral #C9C9CF on black, never aqua" klass="text-[14px] text-muon-fg-body leading-[1.6]" spec="ARCHIVO 500" />
          <TypeRow sample="MICRO-LABEL 10–11 · +0.12EM TRACKING · UPPERCASE" klass="font-muon-mono text-[11px] tracking-[0.12em] text-muon-fg-muted" spec="JETBRAINS MONO 700" />
          <TypeRow sample="−125 cr · 823 / 1,000" klass="font-muon-mono text-[20px] font-bold text-muon-money muon-num" spec="ALL CREDIT NUMERALS + JOB STATES: MONO, TABULAR FIGURES — NON-NEGOTIABLE" />
        </div>
      </Section>

      {/* 03 BUTTONS */}
      <Section num="03" title="BUTTONS — PILL (999PX), COST RIDES THE PRIMARY">
        <div className="border border-muon-border rounded-2xl p-7 flex flex-wrap gap-4 items-center">
          <button className="flex items-center gap-10 bg-muon-accent text-muon-accent-ink rounded-full px-6 py-3.5 font-extrabold hover:bg-muon-accent-hover">
            <span>Generate</span>
            <span className="font-muon-mono text-[13px] font-bold">−15 cr</span>
          </button>
          <button className="bg-muon-money text-muon-money-ink rounded-full px-6 py-3 font-extrabold">Top up · $9</button>
          <button className="bg-transparent border border-muon-border text-muon-fg rounded-full px-6 py-3 font-bold hover:border-muon-accent">Ghost</button>
          <button className="bg-muon-danger text-white rounded-full px-6 py-3 font-extrabold">Open breaker</button>
          <button disabled className="bg-muon-accent text-muon-accent-ink rounded-full px-6 py-3 font-extrabold opacity-40 cursor-not-allowed">Disabled</button>
        </div>
      </Section>

      {/* 04 CHIPS */}
      <Section num="04" title="CHIPS, BADGES">
        <div className="border border-muon-border rounded-2xl p-7 flex flex-wrap gap-3 items-center">
          <span className="inline-flex items-center font-muon-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 border-muon-border text-muon-fg-muted">NEUTRAL</span>
          <span className="inline-flex items-center font-muon-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 border-muon-accent/40 text-muon-accent bg-muon-accent/[0.07]">RECOMMENDED</span>
          <span className="inline-flex items-center font-muon-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 border-muon-money/40 text-muon-money bg-muon-money/[0.07]">PREMIUM ◆</span>
          <span className="inline-flex items-center font-muon-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full px-3 py-1.5 bg-muon-money text-muon-money-ink">MOST PICKED</span>
          <span className="inline-flex items-center font-muon-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 border-muon-danger/40 text-muon-danger bg-muon-danger/[0.07]">FAILED · REFUNDED</span>
        </div>
      </Section>

      {/* 05 PRESET CARD */}
      <Section num="05" title="PRESET CARD ANATOMY">
        <div className="border border-muon-border rounded-2xl p-7">
          <div className="max-w-[300px] rounded-2xl border border-muon-border bg-muon-panel overflow-hidden">
            <div className="h-48 relative" style={{ background: 'linear-gradient(135deg,#1b0632,#5a0e6a,#e4318f)' }}>
              <span className="absolute top-3 left-3 inline-flex items-center font-muon-mono text-[10px] font-bold uppercase tracking-[0.12em] rounded-full border px-3 py-1.5 border-muon-border text-muon-fg-muted bg-black/45 backdrop-blur">CACHED</span>
              <span className="absolute top-3 right-3 font-muon-mono text-[11px] font-bold text-white/85 bg-black/45 backdrop-blur rounded-full px-2.5 py-1 muon-num">▶ 5.8k</span>
            </div>
            <div className="px-4 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-extrabold text-base">NEON ALLEY</div>
                <div className="mt-0.5 text-muon-fg-muted text-xs">Kling 2.6 Pro</div>
              </div>
              <div className="shrink-0 font-muon-mono text-[13px] font-bold text-muon-money muon-num pt-1">23 cr</div>
            </div>
          </div>
          <ul className="mt-5 text-[12px] text-muon-fg-body space-y-1.5">
            <li>• Thumbnail carries the color; chrome (border, text) stays monochrome.</li>
            <li>• Cost lives in mono, tabular, amber — never merges with title weight.</li>
            <li>• Hover: scale-[1.015] over 200ms ease-out.</li>
          </ul>
        </div>
      </Section>

      {/* 06 BALANCE PILL */}
      <Section num="06" title="BALANCE PILL">
        <div className="border border-muon-border rounded-2xl p-7 flex gap-4 items-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-muon-border bg-muon-panel px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-muon-money" />
            <span className="font-muon-mono text-[12px] font-bold text-muon-money muon-num">823 cr</span>
          </span>
          <div className="text-[12px] text-muon-fg-body">
            The counter tick <b className="text-muon-money font-muon-mono muon-num">−15</b> floats up 12px and fades over 1.8s ease-out after a spend.
          </div>
        </div>
      </Section>

      {/* 07 SHAPE MOTION */}
      <Section num="07" title="SHAPE, MOTION">
        <div className="border border-muon-border rounded-2xl p-7 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-muted">RADII</div>
            <ul className="mt-2 text-[13px] text-muon-fg-body space-y-1">
              <li>Cards · 12–16px</li>
              <li>Inputs · 8px</li>
              <li>Buttons + chips · 999px (pill)</li>
              <li>Admin panels · 10px (denser)</li>
              <li>Hairlines · 1px #26262A</li>
            </ul>
          </div>
          <div>
            <div className="font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-muted">MOTION</div>
            <ul className="mt-2 text-[13px] text-muon-fg-body space-y-1">
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
    </div>
  );
}

function Section({ num, title, children }) {
  return (
    <section className="mt-14">
      <div className="font-muon-mono text-[11px] tracking-[0.14em] text-muon-accent mb-4">
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
      <span className="font-muon-mono text-[10px] text-muon-fg-faint">{spec}</span>
    </div>
  );
}
