'use client';
import { useState } from 'react';
import Link from 'next/link';
import { MobileTabs } from '../_MobileNav';
import { BalancePill } from '../../_components/BalancePill';

export default function MobileCreate() {
  const [prompt, setPrompt] = useState('Sunset skate reel — anamorphic, warm grade');

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 flex flex-col p-[14px_18px_12px] overflow-y-auto">
        <div className="flex justify-between items-center mb-3">
          <span className="text-[22px] font-extrabold tracking-[-0.02em]">Studio</span>
          <BalancePill balance={823} />
        </div>

        <div
          className="rounded-[14px] border border-vx-border overflow-hidden relative mb-3 shrink-0"
          style={{ aspectRatio: '16/9', background: 'linear-gradient(135deg,#1b0632 0%,#5a0e6a 55%,#e4318f 100%)' }}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-11 h-11 rounded-full bg-black/50 border border-white/40 flex items-center justify-center">
              <div className="w-0 h-0 border-l-[13px] border-l-white border-y-[8px] border-y-transparent ml-0.5" />
            </div>
          </div>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          className="w-full bg-vx-panel border border-vx-border rounded-[10px] px-3 py-2.5 text-[13px] text-vx-fg leading-[1.5] resize-none mb-3 focus:outline-none focus:border-vx-accent"
        />

        <div className="flex gap-1.5 flex-wrap mb-3">
          <span className="font-vx-mono text-[9.5px] tracking-[0.1em] font-bold px-3.5 py-2 rounded-full text-vx-accent border border-vx-accent/40 bg-vx-accent/[0.07]">
            WAN 2.5 · RECOMMENDED
          </span>
          <button className="font-vx-mono text-[9.5px] tracking-[0.1em] font-bold px-3.5 py-2 rounded-full text-vx-fg-muted border border-vx-border">
            5s
          </button>
          <button className="font-vx-mono text-[9.5px] tracking-[0.1em] font-bold px-3.5 py-2 rounded-full text-vx-fg-muted border border-vx-border">
            16:9
          </button>
        </div>

        <div className="flex-1" />

        <Link
          href="/veyrnox/m/job"
          className="flex justify-between items-center bg-vx-accent text-vx-accent-ink rounded-full px-5 py-3.5 text-[15px] font-extrabold min-h-[50px] mt-2"
        >
          <span>Generate</span>
          <span className="font-vx-mono text-[13px]">−15 cr</span>
        </Link>
        <div className="font-vx-mono text-[8.5px] tracking-[0.1em] text-vx-fg-faint text-center mt-2">
          REFUND ON FAILURE · ALWAYS
        </div>
      </div>
      <MobileTabs />
    </div>
  );
}
