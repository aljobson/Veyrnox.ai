'use client';

import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { captureOperationalError, captureProductEvent } from '../../lib/analyticsClient.js';
import { getSession } from '../../lib/authClient.js';
import { gatewayFetch } from '../_lib/gateway';
import {
  HELP_ACTIONS,
  HELP_TARGETS,
  helpStartersForPath,
  normaliseHelpPlan,
} from '../../../lib/productHelp.js';

const HOME = { x: 18, y: 0 };
const CHARACTER = { width: 112, height: 116 };
const WELCOME = 'Hi, I’m Vey. Ask me how to use Veyrnox and I’ll show you where to go.';
const MAX_CONVERSATION_MESSAGES = 10;

function browserPath(pathname) {
  return (pathname || '/app').replace(/^\/veyrnox/, '') || '/app';
}

function firstVisible(selector) {
  return [...document.querySelectorAll(selector)].find((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }) || null;
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
    targetRef.current = null;
    setActiveTarget(null);
    setHighlight(null);
  }, []);

  const measureTarget = useCallback((element, id) => {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const gap = 16;
    const roomLeft = rect.left >= CHARACTER.width + gap;
    let x = roomLeft ? rect.left - CHARACTER.width - gap : rect.right + gap;
    x = Math.max(8, Math.min(window.innerWidth - CHARACTER.width - 8, x));
    const y = Math.max(72, Math.min(window.innerHeight - CHARACTER.height - 8, rect.top + rect.height / 2 - CHARACTER.height / 2));
    targetRef.current = element;
    setFacing(roomLeft ? 1 : -1);
    setPosition({ x, y });
    setHighlight({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    setActiveTarget(id);
    return true;
  }, []);

  const locateTarget = useCallback((id, options = {}) => {
    const definition = HELP_TARGETS[id];
    if (!definition) return false;
    const element = firstVisible(definition.selector);
    if (!element) return false;
    element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (!measureTarget(element, id)) return;
      if (options.focus && element instanceof HTMLElement) element.focus({ preventScroll: true });
      if (options.activate && definition.canActivate && element instanceof HTMLElement) element.click();
    }, reduceMotion ? 0 : 420);
    return true;
  }, [measureTarget, reduceMotion]);

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
      window.clearTimeout(timerRef.current);
    };
  }, [activeTarget, homePosition, measureTarget, open, perchPosition]);

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

  const ask = useCallback(async (text) => {
    const asked = String(text || '').trim();
    if (!asked || busy) return;
    const history = messages
      .filter((message) => !message.pending)
      .slice(-6)
      .map(({ role, content }) => ({ role, content }));
    const userId = ++messageIdRef.current;
    const assistantId = ++messageIdRef.current;
    setQuestion('');
    setBusy(true);
    setPlan(null);
    setFeedback(null);
    setAnswerSource(null);
    setAnswer('Let me check…');
    setMessages((current) => [...current, { id: userId, role: 'user', content: asked }, { id: assistantId, role: 'assistant', content: 'Let me check…', pending: true }].slice(-MAX_CONVERSATION_MESSAGES));
    captureProductEvent('helper_question', { route: pathname, starter: starters.includes(asked) });
    const startedAt = performance.now();
    let next;
    try {
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
      ? { id: assistantId, role: 'assistant', content: next.message, source: next.source }
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
  }, [pathname, plan, router, showTarget]);

  const action = resolveHelpAction(plan);
  const targetLabel = plan?.target ? HELP_TARGETS[plan.target]?.label : null;
  const showButton = action || (plan?.target && activeTarget !== plan.target);
  const mood = busy ? 'thinking' : activeTarget ? 'guiding' : open ? 'listening' : 'idle';

  const resetConversation = useCallback(() => {
    setMessages([]);
    setAnswer(WELCOME);
    setPlan(null);
    setAnswerSource(null);
    setFeedback(null);
    clearTarget();
    setPosition(homePosition());
    captureProductEvent('helper_reset', { route: pathname });
  }, [clearTarget, homePosition, pathname]);

  const rateAnswer = useCallback((helpful) => {
    setFeedback(helpful ? 'helpful' : 'not_helpful');
    captureProductEvent('helper_feedback', { route: pathname, helpful, source: answerSource || 'unknown' });
  }, [answerSource, pathname]);

  return (
    <>
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
          animate={reduceMotion ? undefined : busy
            ? { rotate: [-2, 2, -2], y: [0, -5, 0] }
            : { y: [0, -7, 0], rotate: [0, 1.5, 0, -1.5, 0] }}
          transition={{ duration: busy ? 0.7 : 3.6, repeat: Infinity, ease: 'easeInOut' }}
          style={{ scaleX: facing }}
        >
          <span className="absolute inset-x-4 bottom-2 h-5 rounded-full bg-black/35 blur-md" aria-hidden="true" />
          <Image
            src="/assistant/veyrnox-helper.png"
            alt=""
            width={384}
            height={399}
            loading="eager"
            className="relative h-full w-full object-contain drop-shadow-[0_12px_22px_rgb(0_0_0/0.34)] transition-[filter] group-hover:brightness-110"
          />
          {!open && !activeTarget && !busy && (
            <span className="absolute -right-2 top-0 rounded-full border border-vx-border bg-vx-panel px-2.5 py-1 font-vx-mono text-[10px] font-bold tracking-[0.08em] text-vx-accent shadow-lg" style={{ transform: `scaleX(${facing})` }}>
              ASK VEY
            </span>
          )}
          {(busy || activeTarget) && (
            <span className="absolute -right-3 top-0 rounded-full border border-vx-accent/40 bg-vx-panel px-2.5 py-1 font-vx-mono text-[9px] font-bold tracking-[0.08em] text-vx-accent shadow-lg" style={{ transform: `scaleX(${facing})` }}>
              {busy ? 'THINKING' : 'GUIDING'}
            </span>
          )}
        </motion.button>
      </motion.div>

      <AnimatePresence>
        {open && (
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
              {messages.length === 0 ? (
                <div role="status" aria-live="polite" className="rounded-2xl rounded-bl-md bg-vx-base px-4 py-3 text-sm leading-6 text-vx-fg-body">
                  {answer}
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((message, index) => {
                    const lastAssistant = message.role === 'assistant' && index === messages.length - 1;
                    return (
                      <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div
                          role={lastAssistant ? 'status' : undefined}
                          aria-live={lastAssistant ? 'polite' : undefined}
                          className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user'
                            ? 'rounded-br-md bg-vx-accent text-vx-accent-ink'
                            : 'rounded-bl-md bg-vx-base text-vx-fg-body'} ${message.pending ? 'animate-pulse' : ''}`}
                        >
                          {message.content}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {showButton && (
                <button type="button" onClick={doAction}
                  className="mt-3 rounded-full bg-vx-accent px-4 py-2 text-sm font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover">
                  {action?.label || `Show ${targetLabel}`}
                </button>
              )}
              {activeTarget && (
                <button type="button" onClick={() => { clearTarget(); setPosition(homePosition()); }}
                  className="ml-2 mt-3 rounded-full border border-vx-border px-4 py-2 text-sm font-semibold text-vx-fg-muted hover:text-vx-fg">
                  Park Vey
                </button>
              )}

              {plan && !busy && (
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-vx-border/70 pt-3">
                  <span className="font-vx-mono text-[9px] font-bold uppercase tracking-[0.1em] text-vx-fg-faint">
                    {answerSource === 'ai' ? 'Live AI · grounded in Veyrnox' : 'Built-in Veyrnox guide'}
                  </span>
                  <div className="flex items-center gap-1" aria-label="Was this answer useful?">
                    <button type="button" onClick={() => rateAnswer(true)} aria-label="Helpful answer" aria-pressed={feedback === 'helpful'}
                      className={`rounded-full px-2 py-1 text-xs ${feedback === 'helpful' ? 'bg-vx-accent/15 text-vx-accent' : 'text-vx-fg-faint hover:text-vx-fg'}`}>Yes</button>
                    <button type="button" onClick={() => rateAnswer(false)} aria-label="Unhelpful answer" aria-pressed={feedback === 'not_helpful'}
                      className={`rounded-full px-2 py-1 text-xs ${feedback === 'not_helpful' ? 'bg-vx-fg/10 text-vx-fg' : 'text-vx-fg-faint hover:text-vx-fg'}`}>No</button>
                  </div>
                </div>
              )}

              {!plan && messages.length === 0 && (
                <div className="mt-4 flex flex-col gap-2">
                  {starters.map((starter) => (
                    <button key={starter} type="button" disabled={busy} onClick={() => ask(starter)}
                      className="rounded-xl border border-vx-border px-3 py-2.5 text-left text-sm font-semibold text-vx-fg-body hover:border-vx-accent hover:text-vx-fg disabled:opacity-50">
                      {starter}
                    </button>
                  ))}
                </div>
              )}
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

