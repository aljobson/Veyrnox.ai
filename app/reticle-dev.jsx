'use client';
import { useEffect } from 'react';
import { journeyStore } from './veyrnox/_lib/veyJourneyStore';

function readVeyLayout() {
  const guide = document.querySelector('[aria-label="Vey task walkthrough"]')?.getBoundingClientRect();
  const question = document.querySelector('[role="dialog"][aria-labelledby="vx-helper-title"]')?.getBoundingClientRect();
  const mascot = document.querySelector('[data-testid="assistant-mascot"]')?.getBoundingClientRect();
  const overlaps = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const controls = [...document.querySelectorAll('main button, main input, main textarea, main select, main summary, main img')]
    .map((el) => el.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0 && rect.top >= 72 && rect.bottom <= innerHeight);
  const interactiveControls = [...document.querySelectorAll('main a, main button, main input, main textarea, main select, main summary')]
    .map((el) => el.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0 && rect.top >= 72 && rect.bottom <= innerHeight);
  const generate = document.querySelector('[data-assistant-target="create.generate"]')?.getBoundingClientRect();
  const cost = document.querySelector('[data-assistant-target="create.cost"]')?.parentElement?.getBoundingClientRect();
  const siteActions = document.querySelector('[data-site-actions]')?.getBoundingClientRect();
  const main = document.querySelector('main')?.getBoundingClientRect();
  return {
    guideOpen: !!guide,
    panelSide: document.querySelector('[data-panel-side]')?.dataset.panelSide,
    mascotPositionMode: document.querySelector('[data-testid="assistant-mascot"]')?.dataset.positionMode,
    moveHintVisible: document.querySelector('[data-testid="assistant-mascot"]')?.textContent.includes('Move me') || false,
    guideHeight: guide ? Math.round(guide.height) : null,
    workspaceDocked: document.documentElement.dataset.veyMobileWorkspace === 'true',
    workspaceClear: !!main && !!guide && main.bottom <= guide.top - 7,
    workspaceScroll: Math.round(document.querySelector('main')?.scrollTop || 0),
    guideVisible: !!guide?.width && guide.top >= 72 && guide.bottom <= innerHeight,
    questionVisible: !!question?.width && question.top >= 72 && question.bottom <= innerHeight,
    questionWidth: question ? Math.round(question.width) : null,
    questionHeight: question ? Math.round(question.height) : null,
    questionBottomGap: question ? Math.round(innerHeight - question.bottom) : null,
    questionFont: parseFloat(getComputedStyle(document.querySelector('#vx-helper-question') || document.body).fontSize),
    panelsClear: !!guide?.width && !!question?.width && !overlaps(guide, question),
    mascotClearPanels: !overlaps(mascot, guide) && !overlaps(mascot, question),
    guideStep: document.querySelector('[aria-label="Vey task walkthrough"]')?.dataset.step,
    docked: document.querySelector('[data-testid="assistant-mascot"]')?.getAttribute('data-mobile-docked') === 'true',
    mascotX: mascot ? Math.round(mascot.left) : null,
    mascotY: mascot ? Math.round(mascot.top) : null,
    scrollPadding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom) || 0,
    scrollY: Math.round(window.scrollY),
    mainPadding: parseFloat(document.querySelector('main')?.style.paddingBottom) || 0,
    costOverlaps: overlaps(mascot, cost),
    mascotOverlaps: controls.filter((rect) => overlaps(mascot, rect)).length,
    generateClear: !!guide && !!generate && generate.top >= 72 && generate.bottom < guide.top,
    sourceAttached: !!document.querySelector('img[alt="Start image"]'),
    rightsConfirmed: document.querySelector('[data-testid="create-source-rights-status"]')?.dataset.confirmed === 'true',
    costCardStatic: document.querySelector('[data-create-cost-card]') ? getComputedStyle(document.querySelector('[data-create-cost-card]')).position === 'static' : false,
    storageNoticeOpen: !!document.querySelector('[aria-label="Browser storage notice"]'),
    siteActionsOverlap: interactiveControls.filter((rect) => overlaps(siteActions, rect)).length,
  };
}

function subscribeVeyLayout(notify) {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      notify();
    });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('scroll', schedule, { passive: true });
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule);
    if (frame) cancelAnimationFrame(frame);
  };
}

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
        registerStore('veyLayout', readVeyLayout, subscribeVeyLayout);
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
