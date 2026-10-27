import { chaosBand } from './creatorArchetype';
import { t } from './i18n';

// Presentation uses answer ids, never words parsed from the rendered archetype name.
export function creatorCardName(answers: { pace?: unknown; chaos?: unknown }): string {
    const pace = typeof answers.pace === 'string' && ['fox', 'owl', 'octopus', 'jellyfish'].includes(answers.pace) ? answers.pace : 'other';
    return t('language.creatorName', {
        adjective: t(`language.creatorAdjective.${chaosBand(answers.chaos)}`),
        noun: t(`language.creatorNoun.${pace}`),
    });
}
