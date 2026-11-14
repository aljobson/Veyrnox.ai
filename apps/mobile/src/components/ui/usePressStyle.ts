import { StyleSheet } from 'react-native';
import { ds } from '../../theme';
import { useReducedMotion } from './useReducedMotion';

const PRESSED_OPACITY = 0.8;
const styles = StyleSheet.create({
    still: { opacity: PRESSED_OPACITY },
    moving: { opacity: PRESSED_OPACITY, transform: [{ scale: ds.motion.pressScale }] },
});

// How a tappable surface looks while a finger is on it: it dims, and a card also shrinks by the press scale unless
// Reduce Motion is on. A row with a divider only dims, so its hairline keeps reaching both edges.
export function usePressStyle(kind: 'card' | 'row' = 'card') {
    const reduced = useReducedMotion();
    return reduced || kind === 'row' ? styles.still : styles.moving;
}
