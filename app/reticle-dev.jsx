'use client';
import { useEffect } from 'react';
import { journeyStore } from './veyrnox/_lib/veyJourneyStore';

/** Dev-only: connect Reticle + install the React adapter, after hydration. */
export function ReticleDev() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    void import('@reticlehq/react').then(
      ({ reticle, install, registerCapabilities, registerStore }) => {
        install();
        // Both provided by withReticle() in next.config. The bridge rejects a connect with no token;
        // the root makes source paths repo-relative instead of absolute.
        const token = process.env.NEXT_PUBLIC_RETICLE_TOKEN;
        const root = process.env.NEXT_PUBLIC_RETICLE_ROOT;
        // withReticle() finds the daemon serving this project on every dev-server start. It wins over
        // any port written into this file at install time, so moving the daemon needs no edit here.
        const url = process.env.NEXT_PUBLIC_RETICLE_URL;
        // So a version-skewed pair names the SDK's version instead of "an unknown older wire".
        const sdkVersion = process.env.NEXT_PUBLIC_RETICLE_SDK_VERSION;
        reticle.connect({
          projectId: 'veyrnox-ai-05603de1', ...(url ? { url } : {}),
          ...(token ? { token } : {}),
          ...(root ? { root } : {}),
          ...(sdkVersion ? { sdkVersion } : {}),
        });

        // ── Start with ONE flow. ────────────────────────────────────────────────────────────────
        // Registering a store is the highest-value line here: it lets the agent check what the app
        // BELIEVES, not just what it rendered. Pass the STORE, not `() => store.getState()` — the
        // store form wires `subscribe` too, so every mutation emits a diff; the getter form is
        // read-only.
        registerStore('veyTask', journeyStore);
        registerStore('veyLayout', () => {
          const guide = document.querySelector('[aria-label="Vey task walkthrough"]')?.getBoundingClientRect();
          const mascot = document.querySelector('[data-testid="assistant-mascot"]')?.getBoundingClientRect();
          const overlaps = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
          const controls = [...document.querySelectorAll('main button, main input, main textarea, main select, main summary, main img')]
            .map(el => el.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0 && r.top >= 72 && r.bottom <= innerHeight);
          const generate = document.querySelector('[data-assistant-target="create.generate"]')?.getBoundingClientRect();
          return { guideOpen: !!guide, mainPadding: parseFloat(document.querySelector('main')?.style.paddingBottom) || 0,
            mascotOverlaps: controls.filter(r => overlaps(mascot, r)).length,
            generateClear: !!guide && !!generate && generate.top >= 72 && generate.bottom < guide.top,
            sourceAttached: !!document.querySelector('img[alt="Start image"]') };
        });
        registerCapabilities({
          testids: ['editor-import'],
          signals: [], // names you pass to reticle.signal()
          stores: ['veyTask', 'veyLayout'],
        });
      },
    );
  }, []);
  return null;
}
