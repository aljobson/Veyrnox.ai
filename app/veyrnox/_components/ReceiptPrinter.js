'use client';
import { motion, useReducedMotion } from 'motion/react';

const FEED = { duration: 1.4, ease: [0.22, 1, 0.36, 1] };

/**
 * A paper receipt that feeds out of a slot once a purchase clears. The motion is decoration only:
 * the rows are in the page from the first frame, and reduced motion shows the slip already printed.
 * @param {{ title: string, rows: { label: string, value: string }[], footer: string }} props
 */
export function ReceiptPrinter({ title, rows, footer }) {
  const still = useReducedMotion();
  return (
    <figure className="mx-auto mt-4 w-full max-w-[19rem]" aria-label={title}>
      <div aria-hidden="true" className="h-2 rounded-full bg-vx-fg/80 shadow-[0_2px_6px_rgb(0_0_0/0.35)]" />
      <div className="-mt-1 overflow-hidden px-3">
        <motion.div
          initial={still ? false : { y: '-100%' }}
          animate={{ y: 0 }}
          transition={FEED}
          className="[mask:conic-gradient(from_-45deg_at_bottom,#0000,#000_1deg_89deg,#0000_90deg)_50%/12px_100%] bg-[#f5f1e8] px-5 pb-6 pt-5 font-vx-mono text-[12px] leading-relaxed text-[#1d1b17]"
        >
          <p aria-hidden="true" className="text-center text-[11px] font-bold uppercase tracking-[0.2em]">{title}</p>
          <hr className="my-2 border-dashed border-[#1d1b17]/35" />
          <dl className="space-y-1">
            {rows.map((row) => (
              <div key={row.label} className="flex justify-between gap-4">
                <dt>{row.label}</dt>
                <dd className="font-semibold tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>
          <hr className="my-2 border-dashed border-[#1d1b17]/35" />
          <p className="text-center opacity-70">{footer}</p>
        </motion.div>
      </div>
    </figure>
  );
}
