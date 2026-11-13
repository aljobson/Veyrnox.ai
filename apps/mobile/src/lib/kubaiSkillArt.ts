import type { ImageSourcePropType } from 'react-native';

// Studio skills that show a coloured Kubai illustration (MIT, https://github.com/kubai087/kubai-icons) instead of a
// tinted line icon. Rendered to 144 px PNGs in assets/icons/kubai; the art carries its own colour, so it is never tinted.
export const KUBAI_SKILL_ART = {
    'model-picker': require('../../assets/icons/kubai/filter.png'),
    'fix-my-photo': require('../../assets/icons/kubai/photo.png'),
    'edit-with-words': require('../../assets/icons/kubai/edit.png'),
    'bring-to-life': require('../../assets/icons/kubai/play.png'),
    'add-sound': require('../../assets/icons/kubai/volume.png'),
    storyboard: require('../../assets/icons/kubai/video.png'),
} as const satisfies Readonly<Record<string, ImageSourcePropType>>;
export type KubaiSkillId = keyof typeof KUBAI_SKILL_ART;
