import { Image } from 'expo-image';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet } from 'react-native';
import { MIN_TARGET } from '../lib/a11y';
import { t } from '../lib/i18n';
import { DEFAULT_SIDE, VEY_PLACEMENT_SLOT, otherSide, parseSide, serializeSide, type VeySide } from '../lib/veyPlacement';
import { colors } from '../theme';

const SIZE = 56;
const EDGE = 16;
// Bottom padding for a scrolling list, so its last row can be scrolled clear of Vey.
export const VEY_CLEARANCE = SIZE + EDGE * 2;

// Vey is the chat entry, as on the web. It floats in a bottom corner, opens the chat, and moves to the other side by a
// long press (or the screen-reader action below). It hides while the keyboard is up so it never covers a text box.
export function VeyMascot() {
    const router = useRouter();
    const [side, setSide] = useState<VeySide>(DEFAULT_SIDE);
    const [typing, setTyping] = useState(false);

    useEffect(() => {
        let alive = true;
        SecureStore.getItemAsync(VEY_PLACEMENT_SLOT)
            .then((raw) => alive && setSide(parseSide(raw)))
            .catch(() => {});
        const show = Keyboard.addListener('keyboardDidShow', () => setTyping(true));
        const hide = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
        return () => {
            alive = false;
            show.remove();
            hide.remove();
        };
    }, []);

    function move() {
        const next = otherSide(side);
        setSide(next);
        SecureStore.setItemAsync(VEY_PLACEMENT_SLOT, serializeSide(next)).catch(() => {});
    }

    if (typing) return null;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('vey.open')}
            accessibilityHint={t('vey.hint')}
            accessibilityActions={[{ name: 'moveSide', label: t('vey.move') }]}
            onAccessibilityAction={(e) => e.nativeEvent.actionName === 'moveSide' && move()}
            hitSlop={Math.max(0, (MIN_TARGET - SIZE) / 2)}
            style={[styles.vey, side === 'left' ? styles.left : styles.right]}
            onPress={() => router.push('/chat')}
            onLongPress={move}
        >
            <Image source={require('../../assets/logo-mark.png')} style={styles.mark} contentFit="contain" accessibilityIgnoresInvertColors />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    vey: { position: 'absolute', bottom: EDGE, width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderColor: colors.accent, borderWidth: 2, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
    left: { left: EDGE },
    right: { right: EDGE },
    mark: { width: 30, height: 28 },
});
