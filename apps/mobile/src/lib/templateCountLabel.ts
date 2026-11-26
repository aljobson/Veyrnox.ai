import type { Translator } from './i18n/translate';

type CountTranslator = Pick<Translator, 't' | 'plural'> & { formatNumber?: (value: number) => string };

// "150 templates". No model count: a template's own model is only its default, and its detail screen lets
// the person run it on several more, so a count of "models" here never matched what they can actually pick.
export function templateCountLabel(tr: CountTranslator, templates: number, crunPreviews?: number | null): string {
    if (Number.isInteger(crunPreviews) && crunPreviews! >= 0) return tr.t('explore.templateTotalWithCrun', {
        ready: tr.formatNumber?.(templates) ?? templates,
        previews: tr.formatNumber?.(crunPreviews!) ?? crunPreviews!,
    });
    if (templates <= 0) return tr.t('explore.templateCountNone', { count: 0 });
    return tr.plural('explore.templateTotal', templates);
}
