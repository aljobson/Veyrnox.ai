'use client';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../components/I18nProvider.jsx';

import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { captureOperationalError, captureProductEvent } from '../../lib/analyticsClient.js';
import { getSession } from '../../lib/authClient.js';
import { gatewayFetch } from '../_lib/gateway';
import VeyConversation from './VeyConversation';
import { VEY_CHAT_STYLE } from '../../../lib/veyChatLayout';
import { firstVisible } from '../../../lib/mascotDom.js';
import { readOddlingLibrary } from '../_lib/oddlingStudio';
import { publicHelpHistory, REVEAL_SAVED_ODDLING } from '../../../lib/savedOddlingHelp.js';
import { browserHelpPlan } from '../../../lib/browserHelp.js';
import {
  HELP_ACTIONS,
  HELP_TARGETS,
  helpStartersForPath,
  normaliseHelpPlan,
} from '../../../lib/productHelp.js';
import VeyCharacter from './VeyCharacter';
import VeyTaskGuide from './VeyTaskGuide';
import VeyPanelSideButton from './VeyPanelSideButton';
import { getJourney } from '../_lib/veyJourneyStore';
import useVeyPointer from '../_lib/useVeyPointer';
import useVeyDrag from '../_lib/useVeyDrag';
import { physicalVeyPanelSide } from '../../../lib/veyPlacement';
import useVeyPlacement from '../_lib/useVeyPlacement';
import useVeyWorkspaceSession from '../_lib/useVeyWorkspaceSession';
import useVeyMobileLayout from '../_lib/useVeyMobileLayout';
import useEditorHelperHost from '../_lib/useEditorHelperHost';
import { EditorHelperLauncher } from './editor/EditorHelperLauncher';
import { splitLocalePath } from '../../../lib/i18n/locales.mjs';
import { clampVeyPosition, VEY_SIZE as CHARACTER } from '../../../lib/veyPointer';

const HOME = { x: 18, y: 0 };
const WELCOME = (t) => (t("public.vey.welcome"));
const MAX_CONVERSATION_MESSAGES = 10;
function browserPath(pathname) {
  return splitLocalePath(pathname || '/app').rest.replace(/^\/veyrnox/, '') || '/app';
}
function resolveHelpAction(plan, t) {
  if (!plan?.action || plan.action === 'none') return null;
  const target = plan.target && HELP_TARGETS[plan.target];
  if (plan.action === 'show_target' && target) {
    return { route: target.route, target: plan.target, label: t('public.vey.show', { target: t.label(target.label) }) };
  }
  if (plan.action === 'focus_target' && target) {
    return { route: target.route, target: plan.target, focus: true, label: t('public.vey.take', { target: t.label(target.label) }) };
  }
  if (plan.action === 'activate_target' && target?.canActivate) {
    return { route: target.route, target: plan.target, activate: true, label: t('public.vey.openTarget', { target: t.label(target.label) }) };
  }
  const action = HELP_ACTIONS[plan.action];
  if (!action) return null;
  return { ...action, label: tOr(t, `public.vey.action.${plan.action}`, action.label) };
}

export default function MascotAssistant() {
  const { t, locale } = useI18n();
  const pathname = browserPath(usePathname());
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const launcherRef = useRef(null);
  const inputRef = useRef(null);
  const timerRef = useRef(0);
  const travelTimerRef = useRef(0);
  const actionTimerRef = useRef(0);
  const messageIdRef = useRef(0);
  const transcriptRef = useRef(null);
  const { open, setOpen, chatting, setChatting } = useVeyWorkspaceSession();
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(WELCOME(t));
  const [messages, setMessages] = useState([]);
  const [plan, setPlan] = useState(null);
  const [answerSource, setAnswerSource] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [position, setPosition] = useState(HOME);
  const { manualPosition, panelSide, setManualPosition, movePanels, resetPosition } = useVeyPlacement();
  const [facing, setFacing] = useState(1);
  const [pendingTarget, setPendingTarget] = useState(null);
  const [pendingSavedId, setPendingSavedId] = useState(null);
  const savedSubjectRef = useRef(null);
  const [travelling, setTravelling] = useState(false);
  const [actionPhase, setActionPhase] = useState('none');
  const [journeyActive, setJourneyActive] = useState(false);
  const [mobilePointRequest, setMobilePointRequest] = useState(null);

  const homePosition = useCallback(() => ({
    x: locale === 'ar' ? Math.max(18, window.innerWidth - CHARACTER.width - 18) : 18,
    y: Math.max(88, window.innerHeight - CHARACTER.height - 20),
  }), [locale]);

  const perchPosition = useCallback(() => {
    const x = Math.max(18, Math.min(330, window.innerWidth - CHARACTER.width - 14));
    return {
      x: locale === 'ar' ? Math.max(18, window.innerWidth - CHARACTER.width - x) : x,
      y: Math.max(72, window.innerHeight - Math.min(650, window.innerHeight - 72)),
    };
  }, [locale]);

  const clearAction = useCallback(() => {
    window.clearTimeout(actionTimerRef.current);
    setActionPhase('none');
  }, []);

  const moveMascot = useCallback((nextPosition, instant = false) => {
    window.clearTimeout(travelTimerRef.current);
    setTravelling(!reduceMotion && !instant);
    setPosition(nextPosition);
    if (reduceMotion || instant) return;
    travelTimerRef.current = window.setTimeout(() => setTravelling(false), 760);
  }, [reduceMotion]);

  const activateTarget = useCallback((element, id) => {
    window.clearTimeout(actionTimerRef.current);
    const travelDelay = reduceMotion ? 0 : 760;
    const tapDelay = reduceMotion ? 0 : 420;
    actionTimerRef.current = window.setTimeout(() => {
      setActionPhase('tapping');
      captureProductEvent('helper_target_tap', { target: id, route: pathname });
      actionTimerRef.current = window.setTimeout(() => {
        if (element.isConnected) element.click();
        actionTimerRef.current = window.setTimeout(() => setActionPhase('none'), reduceMotion ? 0 : 360);
      }, tapDelay);
    }, travelDelay);
  }, [pathname, reduceMotion]);

  const drag = useVeyDrag({ onStart: clearAction, onReset: resetPosition,
    onMove: (next) => { window.clearTimeout(travelTimerRef.current); setTravelling(false); setManualPosition(next); setPosition(next); } });
  const { activeTarget, highlight, hand, point, locate: locateTarget, clear: clearPointer } = useVeyPointer({ reduceMotion, moveMascot, setFacing, activateTarget, clearAction, manualPosition });
  const mobileLayout = useVeyMobileLayout({ open, pathname, position, manualPosition, panelSide: physicalVeyPanelSide(panelSide, locale), highlight, hand, facing, pointRequest: mobilePointRequest, activeTarget, rtl: locale === 'ar' });
  const editorHelperHost = useEditorHelperHost(pathname);
  const clearTarget = useCallback(() => {
    window.clearTimeout(timerRef.current);
    clearAction(); clearPointer(); setPendingTarget(null);
  }, [clearAction, clearPointer]);

  useEffect(() => {
    const update = () => { if (!activeTarget) setPosition(manualPosition ? clampVeyPosition(manualPosition, { width: innerWidth, height: innerHeight }) : open ? perchPosition() : homePosition()); };
    const frame = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', update); };
  }, [activeTarget, homePosition, open, perchPosition, manualPosition]);

  const showTarget = useCallback((id, options = {}) => {
    if (window.innerWidth < 640 && !options.explicit) return;
    const definition = HELP_TARGETS[id];
    if (!definition) return;
    captureProductEvent('helper_show_target', { target: id, route: pathname });
    if (definition.route && !pathname.startsWith(definition.route)) {
      setPendingTarget({ id, focus: !!options.focus, activate: !!options.activate });
      router.push(definition.route);
      return;
    }
    if (window.innerWidth < 640) setMobilePointRequest({ id, nonce: Date.now() });
    locateTarget(id, options);
  }, [locateTarget, pathname, router]);

  useEffect(() => {
    if (!pendingTarget) return;
    const { id, focus, activate } = pendingTarget;
    const definition = HELP_TARGETS[id];
    if (!definition || !pathname.startsWith(definition.route)) return;
    let attempt = 0;
    const find = () => {
      if (locateTarget(id, { focus, activate })) {
        if (window.innerWidth < 640) setMobilePointRequest({ id, nonce: Date.now() });
        return;
      }
      if (attempt++ >= 12) return;
      timerRef.current = window.setTimeout(find, 120);
    };
    timerRef.current = window.setTimeout(() => {
      setPendingTarget((current) => current?.id === id ? null : current);
      find();
    }, 0);
  }, [locateTarget, pathname, pendingTarget]);

  // Re-subscribing scroll listeners must not cancel a journey already in flight.
  useEffect(() => () => {
    window.clearTimeout(timerRef.current);
    window.clearTimeout(travelTimerRef.current);
    window.clearTimeout(actionTimerRef.current);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const escape = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      launcherRef.current?.focus();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [open, setOpen]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [messages, reduceMotion]);

  const availableTargets = useMemo(() => Object.keys(HELP_TARGETS), []);
  const starters = useMemo(() => helpStartersForPath(pathname), [pathname]);

  useEffect(() => {
    if (!pendingSavedId || pathname !== '/app/oddlings') return;
    let attempts = 0;
    const reveal = () => {
      window.dispatchEvent(new CustomEvent(REVEAL_SAVED_ODDLING, { detail: { id: pendingSavedId } }));
      if (firstVisible(HELP_TARGETS['oddlings.saved'].selector)?.getAttribute('data-saved-passport-id') === pendingSavedId) {
        showTarget('oddlings.saved', { align: 'start' });
        setPendingSavedId(null);
      } else if (++attempts < 15) timer = window.setTimeout(reveal, 120);
      else setPendingSavedId(null);
    };
    let timer = window.setTimeout(reveal, 0);
    return () => window.clearTimeout(timer);
  }, [pathname, pendingSavedId, showTarget]);

  const ask = useCallback(async (text, selectedId) => {
    const asked = String(text || '').trim();
    if (!asked || busy) return;
    const history = publicHelpHistory(messages);
    const currentTask = getJourney();
    const local = browserHelpPlan(asked, window.localStorage, {
      ...currentTask, selectedId, previousId: savedSubjectRef.current, pathname,
      loadedId: document.querySelector('[data-assistant-loaded-passport]')?.getAttribute('data-assistant-loaded-passport'),
    });
    savedSubjectRef.current = local?.selectedSavedId || null;
    const userId = ++messageIdRef.current;
    const assistantId = ++messageIdRef.current;
    setQuestion('');
    setBusy(true);
    setPlan(null);
    setFeedback(null);
    setAnswerSource(null);
    setAnswer(t("public.vey.check"));
    setMessages((current) => [...current, { id: userId, role: 'user', content: asked, displayContent: tOr(t, `public.vey.question.${asked}`, asked), localOnly: !!local }, { id: assistantId, role: 'assistant', content: t("public.vey.check"), pending: true, localOnly: !!local }].slice(-MAX_CONVERSATION_MESSAGES));
    captureProductEvent('helper_question', { route: pathname, starter: starters.includes(asked) });
    const startedAt = performance.now();
    let next = local;
    if (!next) try {
      if (!getSession()) throw new Error('signed_out');
      const visibleTargets = Object.entries(HELP_TARGETS)
        .filter(([, definition]) => pathname.startsWith(definition.route) && firstVisible(definition.selector))
        .map(([id]) => id);
      const response = await gatewayFetch('/help', {
        method: 'POST',
        body: JSON.stringify({ question: asked, pathname, targets: availableTargets, visibleTargets, history }),
      });
      next = { ...normaliseHelpPlan(response?.plan), source: response?.plan?.source === 'ai' ? 'ai' : 'guide' };
    } catch (error) {
      const { fallbackHelpPlan } = await import('../../../lib/productHelpFallback.js');
      next = { ...fallbackHelpPlan(asked, pathname, history), source: 'guide' };
      if (error?.message !== 'signed_out') captureOperationalError('helper_request_failed', { route: pathname });
    }
    setAnswer(next.message);
    setPlan(next);
    setAnswerSource(next.source);
    setMessages((current) => current.map((message) => message.id === assistantId
      ? { id: assistantId, role: 'assistant', content: next.message, source: next.source, localOnly: !!next.localOnly }
      : message));
    setBusy(false);
    captureProductEvent('helper_answer', {
      route: pathname,
      source: next.source,
      has_target: !!next.target,
      duration_ms: Math.round(performance.now() - startedAt),
    });
    if (next.target && pathname.startsWith(HELP_TARGETS[next.target]?.route || '#')) showTarget(next.target);
  }, [availableTargets, busy, messages, pathname, showTarget, starters, t]);

  const doAction = useCallback(() => {
    if (plan?.savedOddlingId) {
      if (!readOddlingLibrary(window.localStorage).some(({ id }) => id === plan.savedOddlingId)) {
        ask('Where are my saved Oddling passports?');
        return;
      }
      setPendingSavedId(plan.savedOddlingId);
      if (pathname !== '/app/oddlings') router.push('/app/oddlings');
      return;
    }
    const action = resolveHelpAction(plan, t);
    if (!action) {
      if (plan?.target) showTarget(plan.target, { explicit: true });
      return;
    }
    captureProductEvent('helper_action', { action: plan.action, route: pathname });
    if (action.route && !pathname.startsWith(action.route)) {
      if (action.target || plan?.target) setPendingTarget({
        id: action.target || plan.target,
        focus: !!action.focus,
        activate: !!action.activate,
      });
      router.push(action.route);
      return;
    }
    if (action.target) {
      showTarget(action.target, { explicit: true, focus: action.focus || plan.action === 'focus_prompt', activate: action.activate });
    }
  }, [ask, pathname, plan, router, showTarget, t]);

  const action = resolveHelpAction(plan, t);
  const targetLabel = plan?.target ? HELP_TARGETS[plan.target]?.label : null;
  const showButton = action || (plan?.target && activeTarget !== plan.target);
  const mood = actionPhase === 'tapping'
    ? 'tapping'
    : travelling
      ? 'walking'
      : busy
        ? 'thinking'
        : activeTarget
          ? 'guiding'
          : open
            ? 'listening'
            : 'idle';

  const resetConversation = useCallback(() => {
    savedSubjectRef.current = null;
    setPendingSavedId(null);
    setMessages([]);
    setAnswer(WELCOME(t));
    setPlan(null);
    setAnswerSource(null);
    setFeedback(null);
    clearTarget();
    moveMascot(homePosition());
    captureProductEvent('helper_reset', { route: pathname });
  }, [clearTarget, homePosition, moveMascot, pathname, t]);

  const rateAnswer = useCallback((helpful) => {
    setFeedback(helpful ? 'helpful' : 'not_helpful');
    captureProductEvent('helper_feedback', { route: pathname, helpful, source: answerSource || 'unknown' });
  }, [answerSource, pathname]);

  const toggleHelper = () => {
    setOpen(value => !value);
    captureProductEvent('helper_toggle', { open: !open, route: pathname });
  };

  return (
    <>
      <VeyTaskGuide visible={open} pathname={pathname} onPoint={showTarget} onStop={clearTarget} onActiveChange={setJourneyActive} onAsk={ask} manualPosition={!!manualPosition} onResetPosition={resetPosition} panelSide={panelSide} onMovePanels={movePanels} chatting={chatting} setChatting={setChatting} />
      <AnimatePresence>
        {highlight && (
          <motion.div
            key={activeTarget}
            data-testid="assistant-highlight"
            data-target={activeTarget || undefined}
            aria-hidden="true"
            className="pointer-events-none fixed z-[58] rounded-xl border-2 border-vx-accent shadow-[0_0_0_5px_rgb(var(--vx-accent)/0.18),0_0_34px_rgb(var(--vx-accent)/0.34)]"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
            animate={{ opacity: [0.72, 1, 0.72], scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15, repeat: 0 } }}
            transition={{ opacity: { duration: 1.4, repeat: Infinity }, scale: { duration: 0.25 } }}
            style={highlight}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {actionPhase === 'tapping' && highlight && (
          <motion.div
            key={`tap-${activeTarget}`}
            data-testid="assistant-tap"
            aria-hidden="true"
            className="pointer-events-none fixed z-[59] h-8 w-8 rounded-full border-2 border-vx-accent bg-vx-accent/15"
            style={{ left: point.x - 16, top: point.y - 16 }}
            initial={reduceMotion ? false : { opacity: 0.95, scale: 0.35 }}
            animate={reduceMotion ? { opacity: 0.9, scale: 1 } : { opacity: [0.95, 0], scale: [0.35, 2.1] }}
            exit={{ opacity: 0, transition: { duration: 0.15, repeat: 0 } }}
            transition={{ duration: 0.52, repeat: reduceMotion ? 0 : Infinity, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      {editorHelperHost ? <EditorHelperLauncher host={editorHelperHost} open={open} launcherRef={launcherRef} onToggle={toggleHelper} /> : <motion.div
        data-testid="assistant-mascot"
        data-targeting={activeTarget || undefined}
        data-mood={mood}
        data-position-mode={manualPosition ? 'manual' : 'auto'}
        data-mobile-docked={mobileLayout.docked || undefined}
        data-dragging={drag.dragging}
        className="pointer-events-none fixed left-0 top-0 z-[61]"
        animate={{ x: mobileLayout.position.x, y: mobileLayout.position.y }}
        transition={reduceMotion || manualPosition || mobileLayout.docked ? { duration: 0 } : { type: 'spring', stiffness: 115, damping: 18, mass: 0.8 }}
      >
        <motion.button
          ref={launcherRef}
          type="button"
          aria-label={open ? t("public.vey.close") : t("public.vey.open")}
          aria-expanded={open}
          aria-describedby="vey-position-help"
          {...drag.handlers}
          onClick={toggleHelper}
          className="pointer-events-auto touch-none select-none cursor-grab active:cursor-grabbing group relative block rounded-[17px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent"
          animate={mobileLayout.docked || activeTarget || manualPosition || reduceMotion ? { y: 0 } : travelling
            ? { y: [0, -5, 0] }
            : { y: [0, -3, 0] }}
          transition={{ duration: travelling ? 0.52 : 2.8, repeat: Infinity, ease: 'easeInOut' }}
          style={{ width: CHARACTER.width, height: CHARACTER.height, scaleX: facing }}
        >
          <span id="vey-position-help" className="sr-only">{t("public.vey.drag")}</span>
          <span className="absolute inset-x-4 bottom-2 h-5 rounded-full bg-black/35 blur-md" aria-hidden="true" />
          <span className="relative block h-full w-full transition-[filter] group-hover:brightness-110">
            <VeyCharacter pose={mood} reducedMotion={reduceMotion} hand={mobileLayout.hand} />
          </span>
        </motion.button>
      </motion.div>}

      <AnimatePresence>
        {open && !journeyActive && (
          <motion.section
            role="dialog"
            aria-modal="false"
            aria-labelledby="vx-helper-title"
            initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            style={VEY_CHAT_STYLE}
            data-panel-side={panelSide}
            className={`fixed bottom-[max(8px,env(safe-area-inset-bottom))] ${panelSide === 'left' ? 'start-2' : 'end-2'} z-[60] flex h-[var(--vey-chat-height)] max-h-[calc(100dvh-80px)] w-[min(280px,calc(100vw-80px))] flex-col overflow-hidden rounded-xl border border-vx-border bg-vx-panel/95 shadow-xl backdrop-blur-xl`}
          >
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-vx-border px-2 py-0.5">
              <div>
                <h2 id="vx-helper-title" className="text-xs font-bold">{t("public.vey.ask")}</h2>
              </div>
              <div className="flex items-center gap-2">
                <VeyPanelSideButton side={panelSide} onMove={movePanels} />
                {manualPosition && <button type="button" onClick={resetPosition} aria-label={t("public.vey.dockTitle")} title={t("public.vey.dockTitle")}
                  className="min-h-8 rounded-full px-1 text-[10px] text-vx-fg-muted">{t("public.vey.dock")}</button>}
                {messages.length > 0 && (
                  <button type="button" onClick={resetConversation} aria-label={t("public.vey.newTitle")}
                    className="min-h-8 rounded-full px-2 text-[10px] font-semibold text-vx-fg-muted hover:text-vx-fg">{t("public.vey.new")}</button>
                )}
                <button type="button" onClick={() => { setOpen(false); launcherRef.current?.focus(); }} aria-label={t("public.vey.closeShort")}
                  className="min-h-8 min-w-8 rounded-full text-xs text-vx-fg-muted hover:text-vx-fg">✕</button>
              </div>
            </header>

            <div ref={transcriptRef} role="log" aria-label={t("public.vey.conversation")} className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
              <VeyConversation messages={messages} answer={answer} plan={plan} busy={busy}
                showButton={showButton} actionLabel={plan?.savedOddlingId ? t("public.vey.passport") : (action?.label || t('public.vey.show', { target: t.label(targetLabel) }))}
                doAction={doAction} activeTarget={activeTarget} park={() => { clearTarget(); moveMascot(homePosition()); }}
                answerSource={answerSource} feedback={feedback} rateAnswer={rateAnswer} starters={starters} ask={ask} />
            </div>

            <form className="mt-auto shrink-0 border-t border-vx-border p-1.5" onSubmit={(event) => { event.preventDefault(); ask(question); }}>
              <label htmlFor="vx-helper-question" className="sr-only">{t("public.vey.askLabel")}</label>
              <div className="flex items-end gap-1 rounded-lg border border-vx-border bg-vx-base p-0.5 focus-within:border-vx-accent">
                <textarea
                  ref={inputRef}
                  id="vx-helper-question"
                  rows={1}
                  maxLength={500}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder={t("public.vey.placeholder")}
                  className="min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-xs leading-5 text-vx-fg outline-hidden placeholder:text-vx-fg-faint"
                />
                <button type="submit" disabled={busy || !question.trim()}
                  className="min-h-8 shrink-0 rounded-md bg-vx-accent px-2 text-[11px] font-bold text-vx-accent-ink disabled:opacity-40">
                  {busy ? t("public.vey.thinking") : t("public.vey.send")}
                </button>
              </div>
              <p className="px-1 pt-0.5 text-[9px] leading-3 text-vx-fg-faint">{t("public.vey.approval")}</p>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}

