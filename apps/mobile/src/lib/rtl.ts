import { I18nManager } from 'react-native';
// Only directional navigation glyphs mirror; media playback and physical illustration coordinates do not.
export const directionalStyle = () => I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined;
