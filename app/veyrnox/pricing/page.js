'use client';
import { useState } from 'react';
import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { Chip } from '../_components/Chip';
import { PLANS, PLAN_TOGGLE, MODEL_COST_MATRIX } from '../_lib/tokens';

export default function Pricing() {
  const [audience, setAudience] = useState('individual');
  const [annual, setAnnual] = useState(true);
  const [ultraTierIdx, setUltraTierIdx] = useState(0);

  return (
    <div className="min-h-dvh">
      <MarketingNav />

      {/* ============ HEADER ============ */}
      <section className="max-w-[1200px] mx-auto px-8 pt-20 pb-8 text-center">
        <Chip tone="accent" className="mb-6">CREDITS · NOT TOKENS</Chip>
        <h1 className="text-[56px] font-black tracking-[-0.03em] leading-[1.02] text-balance max-w-[820px] mx-auto">
          One balance. Every model.<br/>No add-ons.
        </h1>
        <p className="text-muon-fg-body mt-5 max-w-[600px] mx-auto leading-[1.65]">
          Pick a plan; credits refresh monthly. Failed jobs refund automatically.
          Ultra unlocks 4K and the full premium tier. Cancel any time.
        </p>

        {/* Individual / Business toggle */}
        <div className="mt-8 inline-flex items-center gap-1 border border-muon-border rounded-full p-1">
          {PLAN_TOGGLE.map((t) => (
            <button
              key={t.key}
              onClick={() => setAudience(t.key)}
              className={`px-5 py-2 text-sm font-bold rounded-full transition-colors ${
                audience === t.key ? 'bg-muon-panel text-muon-fg' : 'text-muon-fg-muted'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Monthly / Annual toggle */}
        <div className="mt-4 inline-flex items-center gap-1 border border-muon-border rounded-full p-1 ml-3">
          <button
            onClick={() => setAnnual(false)}
            className={`px-4 py-2 text-xs font-bold rounded-full ${!annual ? 'bg-muon-panel text-muon-fg' : 'text-muon-fg-muted'}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setAnnual(true)}
            className={`px-4 py-2 text-xs font-bold rounded-full flex items-center gap-2 ${annual ? 'bg-muon-panel text-muon-fg' : 'text-muon-fg-muted'}`}
          >
            Annual
            <span className="font-muon-mono text-[9.5px] tracking-[0.1em] text-muon-money">SAVE UP TO 30%</span>
          </button>
        </div>
      </section>

      {/* ============ PLAN CARDS ============ */}
      <section className="max-w-[1200px] mx-auto px-8 pb-20 grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLANS.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            annual={annual}
            audience={audience}
            ultraTierIdx={ultraTierIdx}
            setUltraTierIdx={setUltraTierIdx}
          />
        ))}
      </section>

      {/* ============ PER-MODEL COST MATRIX ============ */}
      <section className="max-w-[1200px] mx-auto px-8 pb-20">
        <div className="flex items-end justify-between mb-4 flex-wrap gap-2">
          <div>
            <div className="font-muon-mono text-[11px] tracking-[0.14em] text-muon-accent mb-2">COMPARE MODEL COSTS</div>
            <h2 className="text-3xl font-black tracking-[-0.02em]">Every model. Every resolution. Priced up front.</h2>
          </div>
          <div className="font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-muted">
            5s VIDEO CLIP · 10s = 2×
          </div>
        </div>

        <div className="rounded-2xl border border-muon-border bg-muon-panel overflow-hidden overflow-x-auto">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_120px] px-5 py-3 border-b border-muon-border font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-muted min-w-[720px]">
            <div>MODEL</div>
            <div className="text-right">720p</div>
            <div className="text-right">1080p</div>
            <div className="text-right">4K</div>
            <div className="text-right">TYPE</div>
          </div>
          {MODEL_COST_MATRIX.map((m) => (
            <div key={m.model} className="grid grid-cols-[1.4fr_1fr_1fr_1fr_120px] px-5 py-3 border-b border-muon-border/60 last:border-b-0 items-center min-w-[720px]">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">{m.model}</span>
                {m.tag && (
                  <span className={`font-muon-mono text-[9px] tracking-[0.1em] ${
                    m.tag.includes('PREMIUM') ? 'text-muon-money' : 'text-muon-fg-faint'
                  }`}>{m.tag}</span>
                )}
              </div>
              {m.rows.map((r, i) => (
                <div key={i} className="text-right font-muon-mono text-sm font-bold text-muon-money muon-num">
                  {r.cost != null ? `${r.cost} cr` : '—'}
                </div>
              ))}
              <div className="text-right font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-muted">
                {m.kind.toUpperCase()}
              </div>
            </div>
          ))}
          <div className="px-5 py-3 border-t border-muon-border font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-muted text-center">
            THE BUTTON IS THE PRICE TAG · FAILED JOBS REFUND AUTOMATICALLY
          </div>
        </div>
      </section>

      {/* ============ CLOSING ============ */}
      <section className="border-t border-muon-border">
        <div className="max-w-[900px] mx-auto px-8 py-14 text-center">
          <div className="text-3xl font-black tracking-[-0.02em]">Questions before you commit?</div>
          <div className="text-muon-fg-muted mt-2">Free preset gallery, no card — see the models live.</div>
          <Link
            href="/veyrnox/presets"
            className="inline-block mt-6 rounded-full bg-muon-accent text-muon-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-muon-accent-hover"
          >
            Browse the gallery
          </Link>
        </div>
      </section>
    </div>
  );
}

/* ─── Plan card ─── */
function PlanCard({ plan, annual, audience, ultraTierIdx, setUltraTierIdx }) {
  const isUltra = plan.id === 'ultra';
  const activeTier = isUltra ? plan.creditTiers[ultraTierIdx] : null;
  const priceMo = activeTier ? (annual ? activeTier.priceAnnualMo : activeTier.priceMo)
                              : (annual ? plan.priceAnnualMo : plan.priceMo);
  const credits = activeTier ? activeTier.credits : plan.credits;
  const savings = annual ? (plan.priceMo * 12 - priceMo * 12) : 0;
  const businessMult = audience === 'business' ? 3 : 1; // ponytail: business = 3× seats

  return (
    <div
      className={`relative rounded-2xl border p-6 flex flex-col ${
        plan.hot ? 'border-muon-money bg-muon-panel' : 'border-muon-border bg-muon-panel'
      }`}
    >
      {/* Discount badge (annual only) */}
      {annual && (
        <span className="absolute -top-3 left-5">
          <Chip tone="accent">{plan.annualDiscountPct}% OFF</Chip>
        </span>
      )}
      {plan.hot && (
        <span className="absolute -top-3 right-5">
          <Chip tone="solid">MOST PICKED</Chip>
        </span>
      )}
      {plan.badge && (
        <span className="absolute -top-3 right-5">
          <Chip tone="money">{plan.badge}</Chip>
        </span>
      )}

      {/* Header */}
      <div className="font-muon-mono text-[10px] tracking-[0.14em] text-muon-fg-muted uppercase">{plan.tagline}</div>
      <div className="mt-1 text-2xl font-black">{plan.name}</div>

      {/* Credits + equivalence */}
      <div className="mt-4 font-muon-mono text-[22px] font-bold text-muon-money muon-num">
        {new Intl.NumberFormat('en-US').format(credits * businessMult)} cr<span className="text-[13px] text-muon-fg-muted"> / mo</span>
      </div>
      <div className="mt-1 font-muon-mono text-[11px] text-muon-fg-body leading-relaxed">
        {plan.equivalence}
      </div>

      {/* Ultra credit tier selector */}
      {isUltra && (
        <div className="mt-4 flex gap-1.5">
          {plan.creditTiers.map((t, i) => (
            <button
              key={t.credits}
              onClick={() => setUltraTierIdx(i)}
              className={`flex-1 font-muon-mono text-[11px] font-bold py-2 rounded-lg border transition-colors ${
                ultraTierIdx === i
                  ? 'border-muon-money bg-muon-money/10 text-muon-money'
                  : 'border-muon-border text-muon-fg-muted hover:text-muon-fg'
              }`}
            >
              {t.credits >= 1000 ? `${t.credits / 1000}K` : t.credits}
            </button>
          ))}
        </div>
      )}

      {/* Price */}
      <div className="mt-5 flex items-baseline gap-2">
        {annual && (
          <span className="font-muon-mono text-[18px] text-muon-fg-faint line-through muon-num">
            ${activeTier ? activeTier.priceMo : plan.priceMo}
          </span>
        )}
        <span className="font-muon-mono text-[36px] font-bold muon-num">${priceMo * businessMult}</span>
        <span className="text-[11px] text-muon-fg-muted">/mo{annual ? ', billed annually' : ''}</span>
      </div>
      {annual && (
        <div className="mt-1 font-muon-mono text-[11px] text-muon-money muon-num">
          Save ${(savings * businessMult).toLocaleString()} vs monthly
        </div>
      )}

      {/* CTA */}
      <button
        className={`mt-5 rounded-full py-3 text-sm font-extrabold transition-colors ${
          plan.hot
            ? 'bg-muon-money text-muon-money-ink hover:brightness-110'
            : 'bg-muon-accent text-muon-accent-ink hover:bg-muon-accent-hover'
        }`}
      >
        Get {plan.name}
      </button>

      {/* Unlocked models */}
      <div className="mt-6 border-t border-muon-border pt-4">
        <div className="font-muon-mono text-[9.5px] tracking-[0.12em] text-muon-fg-muted mb-2.5">PREMIUM MODELS UNLOCKED</div>
        <ul className="space-y-2">
          {plan.unlockedModels.map((m) => (
            <li key={m.name} className="flex items-start gap-2">
              <span className="text-muon-accent shrink-0 mt-0.5">✓</span>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">{m.name}</div>
                <div className="text-[11px] text-muon-fg-muted font-muon-mono">{m.hint}</div>
              </div>
            </li>
          ))}
        </ul>
        {plan.lockedNote && (
          <div className="mt-3 font-muon-mono text-[10px] text-muon-fg-faint tracking-[0.05em]">
            {plan.lockedNote}
          </div>
        )}
      </div>

      {/* Features */}
      <div className="mt-4 border-t border-muon-border pt-4">
        <div className="font-muon-mono text-[9.5px] tracking-[0.12em] text-muon-fg-muted mb-2.5">INCLUDED</div>
        <ul className="space-y-1.5 text-[12.5px] text-muon-fg-body">
          {plan.features.map((f) => (
            <li key={f} className="flex gap-2"><span className="text-muon-accent">✓</span> {f}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
