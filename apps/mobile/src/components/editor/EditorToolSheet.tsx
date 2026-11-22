import { useContext, useEffect, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { colors } from '../../theme';

/** Share of the window a tool panel may use; the preview and timeline stay visible above it. */
const SHEET_SHARE = 0.46, SHEET_MIN = 250, SHEET_MAX = 420, TOP_ROOM = 96;
const INLINE_MIN = 160;
export const toolSheetHeight = (windowHeight: number) => Math.round(Math.max(SHEET_MIN, Math.min(SHEET_MAX, windowHeight * SHEET_SHARE)));

/** Height of the on-screen keyboard while it is up, so the sheet can ride above it. */
function useKeyboardHeight(): number {
    const [keyboard, setKeyboard] = useState(0);
    useEffect(() => {
        const ios = Platform.OS === 'ios';
        const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', event => setKeyboard(event.endCoordinates.height));
        const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(0));
        return () => { show.remove(); hide.remove(); };
    }, []);
    return keyboard;
}

/**
 * Bottom-anchored tool panel. The editor screen cannot scroll (the timeline owns drag gestures), so an
 * inline panel got squeezed to nothing under the preview and timeline. This overlays a fixed-height
 * sheet instead; `rail` (advanced tool picker) stays above `children` (the panel itself).
 * The screen must not draw its own bottom bar under an open sheet: the sheet owns the bottom edge,
 * keeps clear of the home indicator and lifts above the keyboard so a text field stays visible.
 */
export function EditorToolSheet({ rail, children, inline, wide, minHeight }:
    { rail?: ReactNode; children: ReactNode; inline?: boolean; wide?: boolean; minHeight?: number }) {
    const { height } = useWindowDimensions();
    const inset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
    const keyboard = useKeyboardHeight();
    // Full editor: take the room left under the timeline, so the timeline stays visible and the panel scrolls below the tool strip.
    if (inline) return <KeyboardAvoidingView testID="editor-tool-sheet" behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={TOP_ROOM}
        style={[local.inline, wide && local.inlineWide, !wide && minHeight ? { minHeight: Math.max(INLINE_MIN, minHeight) } : null]}>{rail}{children}</KeyboardAvoidingView>;
    const room = Math.max(SHEET_MIN, height - keyboard - TOP_ROOM);
    return <View testID="editor-tool-sheet" style={[local.sheet, { bottom: keyboard, height: Math.min(toolSheetHeight(height), room), paddingBottom: keyboard ? 0 : inset }]}>{rail}{children}</View>;
}

const local = StyleSheet.create({
    inline: { flex: 1, minHeight: INLINE_MIN, overflow: 'hidden', backgroundColor: colors.surface },
    inlineWide: { flex: 1.4, minWidth: 220, minHeight: 0, maxWidth: '42%', borderStartWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    sheet: { position: 'absolute', left: 0, right: 0, overflow: 'hidden', borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderColor: colors.border, backgroundColor: colors.surface, elevation: 12, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: -4 } },
});
