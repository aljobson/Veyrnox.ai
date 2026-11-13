import { t } from './i18n';
import { exampleSetFor } from './firstProfile';

// The example prompt a creation goal opens the form with. Literal keys, so the translation tooling sees every string.
// Creator, business and pro get product, ad and brand ideas; everyone else the everyday ones (ADR-0339).
const WORK: Record<'image' | 'video' | 'audio', () => string> = {
    image: () => t('create.firstRun.example.work.image'),
    video: () => t('create.firstRun.example.work.video'),
    audio: () => t('create.firstRun.example.work.audio'),
};
const EVERYDAY: Record<'image' | 'video' | 'audio', () => string> = {
    image: () => t('create.firstGoal.example.image'),
    video: () => t('create.firstGoal.example.video'),
    audio: () => t('create.firstGoal.example.audio'),
};

export const firstRunExample = (role: string | null | undefined, goal: 'image' | 'video' | 'audio'): string => (exampleSetFor(role) === 'work' ? WORK : EVERYDAY)[goal]();
