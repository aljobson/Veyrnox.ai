import type { Translator } from './i18n/translate';

// "150 templates". No model count: a template's own model is only its default, and its detail screen lets
// the person run it on several more, so a count of "models" here never matched what they can actually pick.
export function templateCountLabel(tr: Pick<Translator, 't' | 'plural'>, templates: number): string {
    if (templates <= 0) return tr.t('explore.templateCountNone', { count: 0 });
    return tr.plural('explore.templateTotal', templates);
}
