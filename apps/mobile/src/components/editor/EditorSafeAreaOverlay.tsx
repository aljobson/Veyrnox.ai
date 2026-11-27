import { View } from 'react-native';
import { safeAreaGuide, safeAreaPercentStyle, type SafeAreaGuideId } from '../../lib/editorSafeArea';
import { styles } from './fullEditorStyles';

export function EditorSafeAreaOverlay({ id, width, height }: { id: SafeAreaGuideId; width: number; height: number }) {
    const guide = safeAreaGuide(id), frame = safeAreaPercentStyle(id, width, height);
    if (!guide.insets || !frame) return null;
    return <View testID={`editor-safe-area-${guide.id}`} pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={[styles.platformSafeArea, frame]} />;
}
