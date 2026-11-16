import type { Translator } from './i18n/translate';

// "150 templates on 1 model": both numbers go through the plural mechanism, and an empty list reads "0 templates".
export function templateCountLabel(tr: Pick<Translator, 't' | 'plural'>, templates: number, models: number): string {
    if (templates <= 0) return tr.t('explore.templateCountNone', { count: 0 });
    return tr.plural('explore.templateCount', templates, { models: tr.plural('explore.modelCount', models) });
}
