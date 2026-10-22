"use client";
import { useEffect, useRef } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

// Counts up to `value` once it scrolls into view. The server render and the
// reduced-motion path both show the final number, so nothing depends on JS.
export function NumberTicker({ value, locale, duration = 1.2, className, ...props }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reducedMotion = useReducedMotion();
  const format = (n) => new Intl.NumberFormat(locale).format(Math.round(n));

  useEffect(() => {
    if (!inView || reducedMotion || !ref.current) return undefined;
    const node = ref.current;
    const controls = animate(0, value, {
      duration,
      ease: "easeOut",
      onUpdate: (n) => {
        node.textContent = format(n);
      },
    });
    return () => controls.stop();
    // format only closes over `locale`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reducedMotion, value, duration, locale]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)} {...props}>
      {format(value)}
    </span>
  );
}
