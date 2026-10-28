import { skillById, type Skill } from './studioSkills';
import { t } from './i18n';
export interface Workflow { readonly id: string; readonly name: string; readonly blurb: string; readonly outcome: string; readonly steps: readonly string[]; readonly href?: '/film' | '/oddlings' }
export const STUDIO_WORKFLOWS: readonly Workflow[] = [
    { id: 'viral-short', name: t('chatDepth.wf.viral-short.name'), blurb: t('chatDepth.wf.viral-short.blurb'), outcome: t('chatDepth.wf.viral-short.outcome'), steps: ["prompt-writer","storyboard","bring-to-life","add-sound"] },
    { id: 'product-ad', name: t('chatDepth.wf.product-ad.name'), blurb: t('chatDepth.wf.product-ad.blurb'), outcome: t('chatDepth.wf.product-ad.outcome'), steps: ["fix-my-photo","edit-with-words","bring-to-life","add-sound"] },
    { id: 'photo-to-motion', name: t('chatDepth.wf.photo-to-motion.name'), blurb: t('chatDepth.wf.photo-to-motion.blurb'), outcome: t('chatDepth.wf.photo-to-motion.outcome'), steps: ["fix-my-photo","edit-with-words","bring-to-life"] },
    { id: 'consistent-film', name: t('chatDepth.wf.consistent-film.name'), blurb: t('chatDepth.wf.consistent-film.blurb'), outcome: t('chatDepth.wf.consistent-film.outcome'), steps: ["film-setup","film-studio-init","film-breakdown","film-reference-board","film-asset-passport","film-stress-test","film-shot-prompt"], href: '/film' },
    { id: 'oddling-series', name: t('chatDepth.wf.oddling-series.name'), blurb: t('chatDepth.wf.oddling-series.blurb'), outcome: t('chatDepth.wf.oddling-series.outcome'), steps: ["oddling-continuity","storyboard","prompt-writer","bring-to-life"], href: '/oddlings' },
];
export const workflowById = (id: string) => STUDIO_WORKFLOWS.find(workflow => workflow.id === id) ?? null;
export const workflowSteps = (workflow: Workflow): Skill[] => workflow.steps.map(skillById).filter((s): s is Skill => !!s);
