import type { MenuIcon } from './menuIcons';
import type { SkillGroup } from './studioSkills';
import type { FeatureHue } from '../theme';

// The icon and colour each Tools task, Face filter and Studio skill shows on its row. Colour follows what the item
// works on, so a page reads at a glance: blue for photos, violet for video, amber for sound, pink for faces, green for
// writing and anything else.
export type Hue = FeatureHue;
export interface FeatureIcon {
    readonly icon: MenuIcon;
    readonly hue: Hue;
}

const TOOL_ICONS: Readonly<Record<string, FeatureIcon>> = {
    upscale: { icon: 'upscale', hue: 'sky' },
    background: { icon: 'cutout', hue: 'sky' },
    expand: { icon: 'expand', hue: 'sky' },
    edit: { icon: 'magicWand', hue: 'sky' },
    'face-filters': { icon: 'smiley', hue: 'rose' },
    animate: { icon: 'filmReel', hue: 'iris' },
    avatar: { icon: 'userSound', hue: 'iris' },
    lipsync: { icon: 'waveform', hue: 'iris' },
    'video-upscale': { icon: 'monitorPlay', hue: 'iris' },
    'audio-separation': { icon: 'faders', hue: 'amber' },
    'video-sound': { icon: 'speaker', hue: 'amber' },
};
const OTHER_TOOL: FeatureIcon = { icon: 'squares', hue: 'mint' };
export const toolIcon = (taskKey: string): FeatureIcon => TOOL_ICONS[taskKey] ?? OTHER_TOOL;

const FACE_ICONS: Readonly<Record<string, MenuIcon>> = {
    'face-retouch': 'drop',
    'face-enhance': 'sparkle',
    'face-relight': 'lightbulb',
    'face-makeup': 'brush',
    'face-age': 'hourglass',
};
export const faceIcon = (modelId: string): FeatureIcon => ({ icon: FACE_ICONS[modelId] ?? 'smiley', hue: 'rose' });

const SKILL_ICONS: Readonly<Record<string, MenuIcon>> = {
    'prompt-writer': 'penNib',
    'model-picker': 'cpu',
    'fix-my-photo': 'bandaids',
    'edit-with-words': 'chatText',
    'bring-to-life': 'filmReel',
    'add-sound': 'speaker',
    storyboard: 'slideshow',
    'oddling-continuity': 'smiley',
    'fix-my-prompt': 'wrench',
    'film-setup': 'slate',
    'film-studio-init': 'folderPlus',
    'film-breakdown': 'listChecks',
    'film-reference-board': 'pushPin',
    'film-asset-passport': 'idCard',
    'film-stress-test': 'gauge',
    'film-shot-prompt': 'aperture',
};
const GROUP_HUE: Readonly<Record<SkillGroup, Hue>> = { Make: 'mint', Edit: 'sky', Plan: 'iris', Film: 'amber' };
export const skillIcon = (id: string, group: SkillGroup): FeatureIcon => ({ icon: SKILL_ICONS[id] ?? 'chat', hue: GROUP_HUE[group] });

const WORKFLOW_ICONS: Readonly<Record<string, FeatureIcon>> = {
    'viral-short': { icon: 'lightning', hue: 'mint' },
    'product-ad': { icon: 'bag', hue: 'iris' },
    'photo-to-motion': { icon: 'play', hue: 'sky' },
    'consistent-film': { icon: 'film', hue: 'rose' },
    'oddling-series': { icon: 'smiley', hue: 'amber' },
};
export const workflowIcon = (id: string): FeatureIcon => WORKFLOW_ICONS[id] ?? OTHER_TOOL;
