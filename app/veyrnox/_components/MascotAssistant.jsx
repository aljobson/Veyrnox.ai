'use client';

import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { captureOperationalError, captureProductEvent } from '../../lib/analyticsClient.js';
import { getSession } from '../../lib/authClient.js';
import { gatewayFetch } from '../_lib/gateway';
import VeyConversation from './VeyConversation';
import { firstVisible } from '../../../lib/mascotDom.js';
import { readOddlingLibrary } from '../_lib/oddlingStudio';
import { publicHelpHistory, REVEAL_SAVED_ODDLING, savedOddlingHelp } from '../../../lib/savedOddlingHelp.js';
import {
  HELP_ACTIONS,
  HELP_TARGETS,
  helpStartersForPath,
  normaliseHelpPlan,
} from '../../../lib/productHelp.js';
import VeyCharacter from './VeyCharacter';
import VeyTaskGuide from './VeyTaskGuide';
import { getJourney } from '../_lib/veyJourneyStore';
import { journeyStep } from '../../../lib/veyJourney';

const HOME = { x: 18, y: 0 };
const CHARACTER = { width: 112, height: 116 };
const WELCOME = 'Hi, I’m Vey. Ask me how to use Veyrnox and I’ll show you where to go.';
const MAX_CONVERSATION_MESSAGES = 10;
function browserPath(pathname) {
  return (pathname || '/app').replace(/^\/veyrnox/, '') || '/app';
}
function resolveHelpAction(plan) {
  if (!plan?.action || plan.action === 'none') return null;
  const target = plan.target && HELP_TARGETS[plan.target];
  if (plan.action === 'show_target' && target) {
    return { route: target.route, target: plan.target, label: `Show ${target.label}` };
  }
  if (plan.action === 'focus_target' && target) {
    return { route: target.route, target: plan.target, focus: true, label: `Take me to ${target.label}` };
  }
  if (plan.action === 'activate_target' && target?.canActivate) {
    return { route: target.route, target: plan.target, activate: true, label: `Open ${target.label}` };
  }
  return HELP_ACTIONS[plan.action] || null;
}

export default function MascotAssistant() {
  const pathname = browserPath(usePathname());
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const launcherRef = useRef(null);
  const inputRef = useRef(null);
  const targetRef = useRef(null);
  const timerRef = useRef(0);
  const travelTimerRef = useRef(0);
  const actionTimerRef = useRef(0);
  const messageIdRef = useRef(0);
  const transcriptRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(WELCOME);
  const [messages, setMessages] = useState([]);
  const [plan, setPlan] = useState(null);
  const [answerSource, setAnswerSource] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [activeTarget, setActiveTarget] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const [position, setPosition] = useState(HOME);
  const [facing, setFacing] = useState(1);
  const [pendingTarget, setPendingTarget] = useState(null);
  const [pendingSavedId, setPendingSavedId] = useState(null);
  const savedSubjectRef = useRef(null);
  const [travelling, setTravelling] = useState(false);
  const [actionPhase, setActionPhase] = useState('none');
  const [journeyActive, setJourneyActive] = useState(false);

  const homePosition = useCallback(() => ({
    x: 18,
    y: Math.max(88, window.innerHeight - CHARACTER.height - 20),
  }), []);

  const perchPosition = useCallback(() => ({
    x: Math.max(18, Math.min(330, window.innerWidth - CHARACTER.width - 14)),
    y: Math.max(72, window.innerHeight - Math.min(650, window.innerHeight - 72)),
  }), []);

  useEffect(() => {
    if (activeTarget) return undefined;
    const frame = window.requestAnimationFrame(() => {
      setPosition(open ? perchPosition() : homePosition());
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTarget, homePosition, open, perchPosition]);

  const clearTarget = useCallback(() => {
    window.clearTimeout(timerRef.current);
    window.clearTimeout(actionTimerRef.current);
    setActionPhase('none');
    setPendingTarget(null);
    targetRef.current = null;
    setActiveTarget(null);
    setHighlight(null);
  }, []);

  const moveMascot = useCallback((nextPosition) => {
    window.clearTimeout(travelTimerRef.current);
    setTravelling(!reduceMotion);
    setPosition(nextPosition);
    if (reduceMotion) return;
    travelTimerRef.current = window.setTimeout(() => setTravelling(false), 760);
  }, [reduceMotion]);

  const measureTarget = useCallback((element, id) => {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const gap = 16;
    const roomLeft = rect.left >= CHARACTER.width + gap;
    let x = roomLeft ? rect.left - CHARACTER.width - gap : rect.right + gap;
    x = Math.max(8, Math.min(window.innerWidth - CHARACTER.width - 8, x));
    const beside = roomLeft || rect.right + CHARACTER.width + gap < window.innerWidth;
    const targetY = beside ? rect.top + rect.height / 2 - CHARACTER.height / 2 : rect.top > CHARACTER.height + 80 ? rect.top - CHARACTER.height - 8 : rect.bottom + 8;
    const y = Math.max(72, Math.min(window.innerHeight - CHARACTER.height - 8, targetY));
    targetRef.current = element;
    setFacing(roomLeft ? 1 : -1);
    moveMascot({ x, y });
    setHighlight({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    setActiveTarget(id);
    return true;
  }, [moveMascot]);

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

  const locateTarget = useCallback((id, options = {}) => {
    const definition = HELP_TARGETS[id];
    if (!definition) return false;
    const element = firstVisible(definition.selector);
    if (!element) return false;
    window.clearTimeout(actionTimerRef.current);
    setActionPhase('none');
    element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: options.align || 'center', inline: 'nearest' });
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (!measureTarget(element, id)) return;
      if (options.focus && element instanceof HTMLElement) element.focus({ preventScroll: true });
      if (options.activate && definition.canActivate && element instanceof HTMLElement) activateTarget(element, id);
    }, reduceMotion ? 0 : 420);
    return true;
  }, [activateTarget, measureTarget, reduceMotion]);

  const showTarget = useCallback((id, options = {}) => {
    const definition = HELP_TARGETS[id];
    if (!definition) return;
    captureProductEvent('helper_show_target', { target: id, route: pathname });
    if (definition.route && !pathname.startsWith(definition.route)) {
      setPendingTarget({ id, focus: !!options.focus, activate: !!options.activate });
      router.push(definition.route);
      return;
    }
    locateTarget(id, options);
  }, [locateTarget, pathname, router]);

  useEffect(() => {
    if (!pendingTarget) return;
    const { id, focus, activate } = pendingTarget;
    const definition = HELP_TARGETS[id];
    if (!definition || !pathname.startsWith(definition.route)) return;
    let attempt = 0;
    const find = () => {
      if (locateTarget(id, { focus, activate }) || attempt++ >= 12) return;
      timerRef.current = window.setTimeout(find, 120);
    };
    timerRef.current = window.setTimeout(() => {
      setPendingTarget((current) => current?.id === id ? null : current);
      find();
    }, 0);
  }, [locateTarget, pathname, pendingTarget]);

  useEffect(() => {
    const update = () => {
      if (targetRef.current && activeTarget) measureTarget(targetRef.current, activeTarget);
      else setPosition(open ? perchPosition() : homePosition());
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
    };
  }, [activeTarget, homePosition, measureTarget, open, perchPosition]);

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
  }, [open]);

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
    const nextStep = currentTask.task && /\b(next|progress|task|walkthrough|what now|where am i)\b/i.test(asked) ? journeyStep(currentTask.task, { ...currentTask.view, route: pathname }) : null;
    const local = nextStep ? { message: `${nextStep.title}. ${nextStep.message}`, target: nextStep.target, action: 'show_target', source: 'local', localOnly: true } : savedOddlingHelp(asked, window.localStorage, {
      selectedId, previousId: savedSubjectRef.current, pathname,
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
    setAnswer('Let me check…');
    setMessages((current) => [...current, { id: userId, role: 'user', content: asked, localOnly: !!local }, { id: assistantId, role: 'assistant', content: 'Let me check…', pending: true, localOnly: !!local }].slice(-MAX_CONVERSATION_MESSAGES));
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
  }, [availableTargets, busy, messages, pathname, showTarget, starters]);

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
    const action = resolveHelpAction(plan);
    if (!action) {
      if (plan?.target) showTarget(plan.target);
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
      showTarget(action.target, { focus: action.focus || plan.action === 'focus_prompt', activate: action.activate });
    }
  }, [ask, pathname, plan, router, showTarget]);

  const action = resolveHelpAction(plan);
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
    setAnswer(WELCOME);
    setPlan(null);
    setAnswerSource(null);
    setFeedback(null);
    clearTarget();
    moveMascot(homePosition());
    captureProductEvent('helper_reset', { route: pathname });
  }, [clearTarget, homePosition, moveMascot, pathname]);

  const rateAnswer = useCallback((helpful) => {
    setFeedback(helpful ? 'helpful' : 'not_helpful');
    captureProductEvent('helper_feedback', { route: pathname, helpful, source: answerSource || 'unknown' });
  }, [answerSource, pathname]);

  return (
    <>
      <VeyTaskGuide visible={open} pathname={pathname} onPoint={showTarget} onStop={clearTarget} onActiveChange={setJourneyActive} />
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
            exit={{ opacity: 0 }}
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
            style={{ left: highlight.left + highlight.width / 2 - 16, top: highlight.top + highlight.height / 2 - 16 }}
            initial={reduceMotion ? false : { opacity: 0.95, scale: 0.35 }}
            animate={reduceMotion ? { opacity: 0.9, scale: 1 } : { opacity: [0.95, 0], scale: [0.35, 2.1] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.52, repeat: reduceMotion ? 0 : Infinity, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      <motion.div
        data-testid="assistant-mascot"
        data-targeting={activeTarget || undefined}
        data-mood={mood}
        className="fixed left-0 top-0 z-[61]"
        animate={{ x: position.x, y: position.y }}
        transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 115, damping: 18, mass: 0.8 }}
      >
        <motion.button
          ref={launcherRef}
          type="button"
          aria-label={open ? 'Close Veyrnox helper' : 'Ask Veyrnox helper'}
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
            captureProductEvent('helper_toggle', { open: !open, route: pathname });
          }}
          className="group relative block h-[116px] w-[112px] rounded-[34px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent"
          animate={reduceMotion ? undefined : travelling
            ? { y: [0, -5, 0] }
            : { y: [0, -3, 0] }}
          transition={{ duration: travelling ? 0.52 : 2.8, repeat: Infinity, ease: 'easeInOut' }}
          style={{ scaleX: facing }}
        >
          <span className="absolute inset-x-4 bottom-2 h-5 rounded-full bg-black/35 blur-md" aria-hidden="true" />
          <span className="relative block h-full w-full transition-[filter] group-hover:brightness-110">
            <VeyCharacter pose={mood} reducedMotion={reduceMotion} />
          </span>
          {!open && !activeTarget && !busy && (
            <span className="absolute -right-2 top-0 rounded-full border border-vx-border bg-vx-panel px-2.5 py-1 font-vx-mono text-[10px] font-bold tracking-[0.08em] text-vx-accent shadow-lg" style={{ transform: `scaleX(${facing})` }}>
              ASK VEY
            </span>
          )}
          {(busy || activeTarget) && (
            <span className="absolute -right-3 top-0 rounded-full border border-vx-accent/40 bg-vx-panel px-2.5 py-1 font-vx-mono text-[9px] font-bold tracking-[0.08em] text-vx-accent shadow-lg" style={{ transform: `scaleX(${facing})` }}>
              {actionPhase === 'tapping' ? 'TAPPING' : travelling ? 'MOVING' : busy ? 'THINKING' : 'POINTING'}
            </span>
          )}
        </motion.button>
      </motion.div>

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
            className="fixed bottom-4 left-4 z-[60] flex max-h-[min(680px,calc(100dvh-90px))] w-[min(410px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-vx-border bg-vx-panel/95 shadow-2xl backdrop-blur-xl"
          >
            <header className="flex items-center justify-between gap-3 border-b border-vx-border px-5 py-4">
              <div>
                <h2 id="vx-helper-title" className="text-base font-black">Ask Vey</h2>
                <p className="mt-0.5 text-xs text-vx-fg-muted">Your animated Veyrnox guide</p>
              </div>
              <div className="flex items-center gap-2">
                {messages.length > 0 && (
                  <button type="button" onClick={resetConversation} aria-label="Start a new Vey conversation"
                    className="rounded-full border border-vx-border px-3 py-1.5 text-xs font-semibold text-vx-fg-muted hover:text-vx-fg">New</button>
                )}
                <button type="button" onClick={() => { setOpen(false); launcherRef.current?.focus(); }} aria-label="Close helper"
                  className="rounded-full border border-vx-border px-3 py-1.5 text-sm text-vx-fg-muted hover:text-vx-fg">✕</button>
              </div>
            </header>

            <div ref={transcriptRef} role="log" aria-label="Conversation with Vey" className="overflow-y-auto px-5 py-4">
              <VeyConversation messages={messages} answer={answer} plan={plan} busy={busy}
                showButton={showButton} actionLabel={plan?.savedOddlingId ? 'Show this saved passport' : (action?.label || `Show ${targetLabel}`)}
                doAction={doAction} activeTarget={activeTarget} park={() => { clearTarget(); moveMascot(homePosition()); }}
                answerSource={answerSource} feedback={feedback} rateAnswer={rateAnswer} starters={starters} ask={ask} />
            </div>

            <form className="mt-auto border-t border-vx-border p-3" onSubmit={(event) => { event.preventDefault(); ask(question); }}>
              <label htmlFor="vx-helper-question" className="sr-only">Ask how to use Veyrnox</label>
              <div className="flex items-end gap-2 rounded-2xl border border-vx-border bg-vx-base p-2 focus-within:border-vx-accent">
                <textarea
                  ref={inputRef}
                  id="vx-helper-question"
                  rows={2}
                  maxLength={500}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="How do I…?"
                  className="min-h-11 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-vx-fg outline-hidden placeholder:text-vx-fg-faint"
                />
                <button type="submit" disabled={busy || !question.trim()}
                  className="rounded-full bg-vx-accent px-4 py-2 text-sm font-extrabold text-vx-accent-ink disabled:opacity-40">
                  {busy ? 'Thinking…' : 'Ask'}
                </button>
              </div>
              <p className="px-2 pt-2 text-[11px] leading-4 text-vx-fg-faint">Vey can guide and open safe areas. You always confirm spending, publishing and deletion.</p>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}

