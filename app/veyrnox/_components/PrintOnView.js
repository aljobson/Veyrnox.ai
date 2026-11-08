'use client';

import { useEffect, useRef } from 'react';

// Flags a block once it is well inside the viewport, so CSS can play a
// one-shot entrance (.vx-feed in veyrnox.css) at the moment it is seen and
// not at page load, where it would run off screen. It never un-flags:
// scrolling back up does not reprint the slip. The flag is written to the
// element, not kept in state: nothing React renders depends on it, so there
// is no re-render, and the prop stays "false" so React never writes it back.
// Without IntersectionObserver the block is flagged at once, and the CSS only
// hides lines where script runs, so nothing is ever left invisible.
export function PrintOnView({ className = '', children }) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const print = () => { node.dataset.printed = 'true'; };
    if (typeof IntersectionObserver === 'undefined') {
      print();
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          print();
          observer.disconnect();
        }
      },
      { threshold: 0.4, rootMargin: '0px 0px -10% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} data-printed="false" className={`vx-feed ${className}`}>
      {children}
    </div>
  );
}
