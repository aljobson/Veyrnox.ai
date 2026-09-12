'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { Chip } from '../_components/Chip';
import { PLANS, PLAN_TOGGLE, MODELS as MODELS_FALLBACK } from '../_lib/tokens';

// Live catalog fetch — public, unauthenticated. Falls back to tokens.js
// MODELS if the endpoint is unreachable so the page never renders blank.
function useLiveCatalog() {
  const [catalog, setCatalog] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/catalog', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.models) && data.models.length) {
          setCatalog(data.models);
        } else if (!cancelled) {
          throw new Error('empty');
        }
      } catch {
        if (!cancelled) setCatalog(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  // Normalise fallback to same shape.
  if (catalog) return { models: catalog, live: true };
  return {
    models: MODELS_FALLBACK.map((m) => ({
      id: m.id, name: m.name, modality: m.kind, credits: m.credits, gated: !!m.premium,
    })),
    live: false,
  };
}

export default function Pricing() {
  const [audience, setAudience] = useState('individual');
  const [annual, setAnnual] = useState(true);
  const [ultraTierIdx, setUltraTierIdx] = useState(0);
  const { models: liveModels, live } = useLiveCatalog();

  return (
    <div className="min-h-dvh">
      <MarketingNav />

      {/* ============ HEADER ============ */}
      <section className="max-w-[1200px] mx-auto px-8 pt-20 pb-8 text-center">
        <Chip tone="accent" className="mb-6">CREDITS · NOT TOKENS</Chip>
        <h1 className="text-[56px] font-black tracking-[-0.03em] leading-[1.02] text-balance max-w-[820px] mx-auto">
          One balance. Every model.<br/>No add-ons.
        </h1>
        <p className="text-vx-fg-body mt-5 max-w-[600px] mx-auto leading-[1.65]">
          Pick a plan; credits refresh monthly. Failed jobs refund automatically.
          Ultra unlocks 4K and the full premium tier. Cancel any time.
        </p>

        {/* Individual / Business toggle */}
        <div className="mt-8 inline-flex items-center gap-1 border border-vx-border rounded-full p-1">
          {PLAN_TOGGLE.map((t) => (
            <button
              key={t.key}
              onClick={() => setAudience(t.key)}
              className={`px-5 py-2 text-sm font-bold rounded-full transition-colors ${
                audience === t.key ? 'bg-vx-panel text-vx-fg' : 'text-vx-fg-muted'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Monthly / Annual toggle */}
        <div className="mt-4 inline-flex items-center gap-1 border border-vx-border rounded-full p-1 ml-3">
          <button
            onClick={() => setAnnual(false)}
            className={`px-4 py-2 text-xs font-bold rounded-full ${!annual ? 'bg-vx-panel text-vx-fg' : 'text-vx-fg-muted'}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setAnnual(true)}
            className={`px-4 py-2 text-xs font-bold rounded-full flex items-center gap-2 ${annual ? 'bg-vx-panel text-vx-fg' : 'text-vx-fg-muted'}`}
          >
            Annual
            <span className="font-vx-mono text-[9.5px] tracking-[0.1em] text-vx-money">SAVE UP TO 27%</span>
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
            liveModels={liveModels}
          />
        ))}
      </section>

      {/* ============ LIVE MODEL CATALOG ============ */}
      <section className="max-w-[1200px] mx-auto px-8 pb-20">
        <div className="flex items-end justify-between mb-4 flex-wrap gap-2">
          <div>
            <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent mb-2">
              LIVE CATALOG · 5s CLIP PRICING
            </div>
            <h2 className="text-3xl font-black tracking-[-0.02em]">Every model. Priced up front.</h2>
          </div>
          <div className="flex items-center gap-3">
            {live ? (
              <span className="inline-flex items-center gap-1.5 font-vx-mono text-[10px] tracking-[0.12em] text-vx-accent">
                <span aria-hidden="true">●</span> LIVE
              </span>
            ) : (
              <span className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">CACHED</span>
            )}
            <div className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
              10s VIDEO = 2×
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-vx-border bg-vx-panel overflow-hidden overflow-x-auto">
          <div className="grid grid-cols-[1.4fr_1fr_120px_120px] px-5 py-3 border-b border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted min-w-[640px]">
            <div>MODEL</div>
            <div>MODALITY</div>
            <div className="text-right">CREDITS · 5s</div>
            <div className="text-right">ACCESS</div>
          </div>
          {liveModels.map((m) => (
            <div key={m.id} className="grid grid-cols-[1.4fr_1fr_120px_120px] px-5 py-3 border-b border-vx-border/60 last:border-b-0 items-center min-w-[640px]">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-bold truncate">{m.name}</span>
                {m.gated && (
                  <span className="font-vx-mono text-[9px] tracking-[0.1em] text-vx-money">◆ PREMIUM</span>
                )}
              </div>
              <div className="font-vx-mono text-[11px] tracking-[0.1em] text-vx-fg-muted uppercase">
                {m.modality}
              </div>
              <div className="text-right font-vx-mono text-sm font-bold text-vx-money vx-num">
                {m.credits} cr
              </div>
              <div className="text-right font-vx-mono text-[10px] tracking-[0.1em]">
                {m.gated ? (
                  <span className="text-vx-money">GATED</span>
                ) : (
                  <span className="text-vx-accent">OPEN</span>
                )}
              </div>
            </div>
          ))}
          <div className="px-5 py-3 border-t border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted text-center">
            THE BUTTON IS THE PRICE TAG · FAILED JOBS REFUND AUTOMATICALLY
          </div>
        </div>
      </section>

      {/* ============ CLOSING ============ */}
      <section className="border-t border-vx-border">
        <div className="max-w-[900px] mx-auto px-8 py-14 text-center">
          <div className="text-3xl font-black tracking-[-0.02em]">Questions before you commit?</div>
          <div className="text-vx-fg-muted mt-2">Free preset gallery, no card — see the models live.</div>
          <Link
            href="/veyrnox/presets"
            className="inline-block mt-6 rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-vx-accent-hover"
          >
            Browse the gallery
          </Link>
        </div>
      </section>
    </div>
  );
}

/* ─── Plan card ─── */
// The static equivalence strings went stale whenever a price moved or a
// credit tier was selected. Derive it from the credits on the card and the
// catalog the page already loaded.
function equivalence(credits, models) {
  const priceOf = (id, fallback) => {
    const row = models.find((m) => m.id === id);
    return row && row.credits > 0 ? row.credits : fallback;
  };
  const stills = Math.floor(credits / priceOf('nano-banana', 3));
  const clips = Math.floor(credits / priceOf('wan-2.5', 16));
  const fmt = new Intl.NumberFormat('en-US');
  return `= ${fmt.format(stills)} Nano Banana stills   ~ ${fmt.format(clips)} Wan 2.5 clips`;
}

function PlanCard({ plan, annual, audience, ultraTierIdx, setUltraTierIdx, liveModels }) {
  const isUltra = plan.id === 'ultra';
  const activeTier = isUltra ? plan.creditTiers[ultraTierIdx] : null;
  const priceMo = activeTier ? (annual ? activeTier.priceAnnualMo : activeTier.priceMo)
                              : (annual ? plan.priceAnnualMo : plan.priceMo);
  const credits = activeTier ? activeTier.credits : plan.credits;
  // Compare like with like: the selected tier's own monthly price against
  // its annual price. Using the plan headline made every Ultra tier above
  // the first print a negative "saving".
  const monthlyForSelection = activeTier ? activeTier.priceMo : plan.priceMo;
  const savings = annual ? (monthlyForSelection - priceMo) * 12 : 0;
  const businessMult = audience === 'business' ? 3 : 1; // ponytail: business = 3× seats

  return (
    <div
      className={`relative rounded-2xl border p-6 flex flex-col ${
        plan.hot ? 'border-vx-money bg-vx-panel' : 'border-vx-border bg-vx-panel'
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
      <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted uppercase">{plan.tagline}</div>
      <div className="mt-1 text-2xl font-black">{plan.name}</div>

      {/* Credits + equivalence */}
      <div className="mt-4 font-vx-mono text-[22px] font-bold text-vx-money vx-num">
        {new Intl.NumberFormat('en-US').format(credits * businessMult)} cr<span className="text-[13px] text-vx-fg-muted"> / mo</span>
      </div>
      <div className="mt-1 font-vx-mono text-[11px] text-vx-fg-body leading-relaxed">
        {equivalence(credits * businessMult, liveModels)}
      </div>

      {/* Ultra credit tier selector */}
      {isUltra && (
        <div className="mt-4 flex gap-1.5">
          {plan.creditTiers.map((t, i) => (
            <button
              key={t.credits}
              onClick={() => setUltraTierIdx(i)}
              className={`flex-1 font-vx-mono text-[11px] font-bold py-2 rounded-lg border transition-colors ${
                ultraTierIdx === i
                  ? 'border-vx-money bg-vx-money/10 text-vx-money'
                  : 'border-vx-border text-vx-fg-muted hover:text-vx-fg'
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
          <span className="font-vx-mono text-[18px] text-vx-fg-faint line-through vx-num">
            ${activeTier ? activeTier.priceMo : plan.priceMo}
          </span>
        )}
        <span className="font-vx-mono text-[36px] font-bold vx-num">${priceMo * businessMult}</span>
        <span className="text-[11px] text-vx-fg-muted">/mo{annual ? ', billed annually' : ''}</span>
      </div>
      {annual && (
        <div className="mt-1 font-vx-mono text-[11px] text-vx-money vx-num">
          Save ${(savings * businessMult).toLocaleString()} vs monthly
        </div>
      )}

      {/* CTA */}
      {/* ?auth=sign_up opens AuthGate on mount (89aad5c); ?plan= is ignored
          today but survives into the callback URL for Phase 4 checkout. */}
      <Link
        href={`/app?auth=sign_up&plan=${plan.id}`}
        className={`mt-5 block text-center rounded-full py-3 text-sm font-extrabold transition-colors ${
          plan.hot
            ? 'bg-vx-money text-vx-money-ink hover:brightness-110'
            : 'bg-vx-accent text-vx-accent-ink hover:bg-vx-accent-hover'
        }`}
      >
        Get {plan.name}
      </Link>

      {/* Unlocked models */}
      <div className="mt-6 border-t border-vx-border pt-4">
        <div className="font-vx-mono text-[9.5px] tracking-[0.12em] text-vx-fg-muted mb-2.5">PREMIUM MODELS UNLOCKED</div>
        <ul className="space-y-2">
          {plan.unlockedModels.map((m) => (
            <li key={m.name} className="flex items-start gap-2">
              <span className="text-vx-accent shrink-0 mt-0.5">✓</span>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">{m.name}</div>
                <div className="text-[11px] text-vx-fg-muted font-vx-mono">{m.hint}</div>
              </div>
            </li>
          ))}
        </ul>
        {plan.lockedNote && (
          <div className="mt-3 font-vx-mono text-[10px] text-vx-fg-faint tracking-[0.05em]">
            {plan.lockedNote}
          </div>
        )}
      </div>

      {/* Features */}
      <div className="mt-4 border-t border-vx-border pt-4">
        <div className="font-vx-mono text-[9.5px] tracking-[0.12em] text-vx-fg-muted mb-2.5">INCLUDED</div>
        <ul className="space-y-1.5 text-[12.5px] text-vx-fg-body">
          {plan.features.map((f) => (
            <li key={f} className="flex gap-2"><span className="text-vx-accent">✓</span> {f}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
