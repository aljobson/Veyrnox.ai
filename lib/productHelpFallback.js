import { HELP_PLAN_DEFAULT, normaliseHelpPlan } from './productHelp.js';
import { searchAutomaticProductKnowledge, searchProductKnowledge } from './productKnowledge.js';

/** A reliable no-network answer, loaded lazily by the browser. */
export function fallbackHelpPlan(question, pathname = '/app', history = []) {
    const q = String(question || '').trim();
    if (!q) return { ...HELP_PLAN_DEFAULT };
    if (/press.*generate|generate (it|this|that|for me)/i.test(q)) return normaliseHelpPlan({
        message: 'I can show you the final Generate button, but I cannot press it. Check the displayed cost and inputs first, then you decide whether to spend Credits.',
        target: 'create.generate', action: 'none',
    });
    const recentUserContext = Array.isArray(history)
        ? history.filter((item) => item?.role === 'user').slice(-2).map((item) => String(item.content || '').slice(0, 500))
        : [];
    const contextualQuestion = [...recentUserContext, q].join(' ');
    const entry = searchProductKnowledge(contextualQuestion, pathname, 1)[0];
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
