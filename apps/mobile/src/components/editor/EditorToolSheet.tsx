import { type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { colors } from '../../theme';

/** Share of the window a tool panel may use; the preview and timeline stay visible above it. */
const SHEET_SHARE = 0.46, SHEET_MIN = 250, SHEET_MAX = 420;
export const toolSheetHeight = (windowHeight: number) => Math.round(Math.max(SHEET_MIN, Math.min(SHEET_MAX, windowHeight * SHEET_SHARE)));

/**
 * Bottom-anchored tool panel. The editor screen cannot scroll (the timeline owns drag gestures), so an
 * inline panel got squeezed to nothing under the preview and timeline. This overlays a fixed-height
 * sheet instead; `rail` (advanced tool picker) stays above `children` (the panel itself).
 */
export function EditorToolSheet({ rail, children }: { rail?: ReactNode; children: ReactNode }) {
    const { height } = useWindowDimensions();
    return <View testID="editor-tool-sheet" style={[local.sheet, { height: toolSheetHeight(height) }]}>{rail}{children}</View>;
}

const local = StyleSheet.create({
    sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden', borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderColor: colors.border, backgroundColor: colors.surface, elevation: 12, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: -4 } },
});
