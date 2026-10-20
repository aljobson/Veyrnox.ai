import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet } from 'react-native';
import { MIN_TARGET } from '../lib/a11y';
import { t } from '../lib/i18n';
import { DEFAULT_SIDE, VEY_PLACEMENT_SLOT, otherSide, parseSide, serializeSide, type VeySide } from '../lib/veyPlacement';
import { VeyCharacter } from './VeyCharacter';
import { heightFor } from '../lib/veyCharacter';

// The character is drawn as wide as the old round button was tall, plus room for its arms.
const WIDTH = 56;
const HEIGHT = heightFor(WIDTH);
const EDGE = 16;
// Bottom padding for a scrolling list, so its last row can be scrolled clear of Vey.
export const VEY_CLEARANCE = Math.ceil(HEIGHT) + EDGE * 2;

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
            hitSlop={Math.max(0, (MIN_TARGET - Math.min(WIDTH, HEIGHT)) / 2)}
            style={[styles.vey, side === 'left' ? styles.left : styles.right]}
            onPress={() => router.push('/chat')}
            onLongPress={move}
        >
            <VeyCharacter width={WIDTH} />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    vey: { position: 'absolute', bottom: EDGE, width: WIDTH, height: HEIGHT },
    left: { left: EDGE },
    right: { right: EDGE },
});
