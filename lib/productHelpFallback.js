import { HELP_PLAN_DEFAULT, normaliseHelpPlan } from './productHelp.js';
import { SUPPORT_EMAIL, isGroundedQuestion, searchAutomaticProductKnowledge, searchProductKnowledge } from './productKnowledge.js';

/** What Vey says when nothing reviewed covers the question: no guess, and where to ask. */
export function unknownAnswerPlan() {
  return normaliseHelpPlan({
    message: `I do not have a reviewed answer for that, and I cannot see your account, so I will not guess. For billing, refunds or account problems email ${SUPPORT_EMAIL} with your account email. I can help with Create, Chat, Library, Credits and the other workspaces.`,
    target: null,
    action: 'none',
  });
}

/** True when this question, or a short follow-up to a grounded one, has reviewed knowledge behind it. */
export function hasGroundedAnswer(question, history = []) {
  if (isGroundedQuestion(question)) return true;
  const words = String(question || '').trim().split(/\s+/).length;
  if (words > 5 || !Array.isArray(history)) return false;
  return history.filter((item) => item?.role === 'user').slice(-2).some((item) => isGroundedQuestion(item.content));
}

/** A reliable no-network answer, loaded lazily by the browser. */
export function fallbackHelpPlan(question, pathname = '/app', history = []) {
    const q = String(question || '').trim();
    if (!q) return { ...HELP_PLAN_DEFAULT };
    if (!hasGroundedAnswer(q, history)) return unknownAnswerPlan();
    if (/press.*generate|generate (it|this|that|for me)/i.test(q)) return normaliseHelpPlan({
        message: 'I can show you the final Generate button, but I cannot press it. Check the displayed cost and inputs first, then you decide whether to spend Credits.',
        target: 'create.generate', action: 'none',
    });
    const recentUserContext = Array.isArray(history)
        ? history.filter((item) => item?.role === 'user').slice(-2).map((item) => String(item.content || '').slice(0, 500))
        : [];
    const contextualQuestion = [...recentUserContext, q].join(' ');
    const direct = searchProductKnowledge(q, pathname, 1)[0];
    // An explicit cast question replaces the previous character subject.
    // Otherwise two names in the combined history tie and the older one wins.
    const entry = direct.id.startsWith('oddling-')
        ? direct
        : searchProductKnowledge(contextualQuestion, pathname, 1)[0];
    if (entry.id === 'product-overview' && pathname !== '/app') {
        const discovered = searchAutomaticProductKnowledge(contextualQuestion, pathname, { routes: 1, documents: 0 }).routes[0];
        if (discovered && discovered.route === pathname) {
            const sentencePart = (value) => String(value || '').replace(/[.!?]+$/, '').trim();
            const title = sentencePart(discovered.title);
            const sections = discovered.headings
                .filter((heading) => sentencePart(heading).toLocaleLowerCase() !== title.toLocaleLowerCase())
                .slice(0, 4)
                .map(sentencePart)
                .join(', ');
            const controls = discovered.controls.slice(0, 4).join(', ');
            return normaliseHelpPlan({
                message: `${title} is part of Veyrnox.${sections ? ` Its main sections include ${sections}.` : ''}${controls ? ` You can use controls labelled ${controls}.` : ''} Ask me about the task you want to complete here.`.slice(0, 700),
                target: null,
                action: 'none',
            });
        }
    }
    const steps = entry.steps.slice(0, 4).map((step, index) => `${index + 1}. ${step}`).join(' ');
    return normaliseHelpPlan({
        message: `${entry.summary} ${steps}`.slice(0, 700),
        target: entry.target || null,
        action: entry.action || (entry.target ? 'show_target' : 'none'),
    });
}
