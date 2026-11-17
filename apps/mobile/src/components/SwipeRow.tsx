import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, I18nManager, PanResponder, Pressable, View, type LayoutChangeEvent } from 'react-native';
import { playSelection } from '../lib/haptics';
import { Text } from './ui/Text';
import { themedStyles, useThemedStyles } from './ui/AppearanceContext';
import { useReducedMotion } from './ui/useReducedMotion';

export type SwipeTone = 'danger' | 'accent' | 'neutral';

export interface SwipeAction {
    key: string;
    // Visible word on the button, already translated.
    label: string;
    // What a screen reader says; defaults to the label. Name the row so "Delete" is not ambiguous.
    accessibilityLabel?: string;
    tone?: SwipeTone;
    onPress: () => void;
}

export interface SwipeRowProps {
    children: ReactNode;
    // Buttons that slide out from under the row, outermost first. Empty means a plain row.
    actions: SwipeAction[];
    // A long swipe runs the first action without a tap, as in Mail. Leave off for anything that needs a confirmation
    // dialog of its own: the dialog still appears, the swipe just opens it.
    fullSwipe?: boolean;
    disabled?: boolean;
}

export const ACTION_WIDTH = 84;
// Past this share of the row width a release runs the first action.
export const FULL_SWIPE_SHARE = 0.6;
// Movement before the row takes the gesture from the list, and how much more sideways than vertical it must be.
const CLAIM_PX = 8;
const CLAIM_RATIO = 1.5;
const FLICK_VELOCITY = 0.5;

// Only one row is open at a time: opening another closes the last.
let closeOpenRow: (() => void) | null = null;

// A pure rule so it can be tested without a renderer: where does a release leave the row?
// `travelled` and `speed` are positive towards the revealed side.
export function settleTarget(travelled: number, speed: number, reveal: number, width: number, fullSwipe: boolean): 'full' | 'open' | 'closed' {
    if (fullSwipe && width > 0 && travelled > width * FULL_SWIPE_SHARE) return 'full';
    if (travelled > reveal / 2 || (speed > FLICK_VELOCITY && travelled > 12)) return 'open';
    return 'closed';
}

// Swipe a row sideways to reveal its actions, without a native gesture library: the built-in responder and Animated, so
// it works in the build that is already installed.
export function SwipeRow({ children, actions, fullSwipe = false, disabled = false }: SwipeRowProps) {
    const s = useThemedStyles(sheets);
    const reduced = useReducedMotion();
    const x = useRef(new Animated.Value(0)).current;
    const offset = useRef(0);
    const start = useRef(0);
    const width = useRef(0);
    const armed = useRef(false);
    const [open, setOpen] = useState(false);
    const live = useRef({ actions, fullSwipe, disabled, reduced });
    live.current = { actions, fullSwipe, disabled, reduced };
    // The row slides towards the start of the reading direction's end: left in left-to-right, right in right-to-left.
    const dir = I18nManager.isRTL ? 1 : -1;
    const reveal = actions.length * ACTION_WIDTH;
    const canSwipe = !disabled && actions.length > 0;

    useEffect(() => {
        const id = x.addListener(({ value }) => { offset.current = value; });
        return () => x.removeListener(id);
    }, [x]);

    function settle(to: number, done?: () => void) {
        const cfg = live.current.reduced
            ? Animated.timing(x, { toValue: to, duration: 0, useNativeDriver: true })
            : Animated.spring(x, { toValue: to, useNativeDriver: true, bounciness: 0, speed: 22 });
        cfg.start(({ finished }) => { if (finished) done?.(); });
    }
    function close() {
        settle(0);
        setOpen(false);
        if (closeOpenRow === close) closeOpenRow = null;
    }
    function openFully() {
        if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
        closeOpenRow = close;
        settle(dir * reveal);
        setOpen(true);
    }
    // Closed when the row goes away (a deleted row unmounts) so a stale closer never runs.
    useEffect(() => () => { if (closeOpenRow === close) closeOpenRow = null; }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const responder = useMemo(() => PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => {
            if (!live.current.disabled && live.current.actions.length === 0) return false;
            return !live.current.disabled && Math.abs(g.dx) > CLAIM_PX && Math.abs(g.dx) > Math.abs(g.dy) * CLAIM_RATIO;
        },
        onPanResponderGrant: () => {
            start.current = offset.current;
            armed.current = false;
            if (closeOpenRow && start.current === 0) closeOpenRow();
        },
        onPanResponderMove: (_e, g) => {
            const max = live.current.actions.length * ACTION_WIDTH;
            const limit = live.current.fullSwipe ? Math.max(width.current, max) : max * 1.15;
            // Towards the revealed side is positive "travelled"; never drag the row the other way past rest.
            const travelled = Math.min(Math.max(-dir * (start.current + g.dx), 0), limit);
            x.setValue(dir * travelled);
            const pastFull = live.current.fullSwipe && width.current > 0 && travelled > width.current * FULL_SWIPE_SHARE;
            if (pastFull !== armed.current) { armed.current = pastFull; void playSelection(); }
        },
        onPanResponderRelease: (_e, g) => {
            const { actions: list, fullSwipe: full } = live.current;
            const max = list.length * ACTION_WIDTH;
            const target = settleTarget(-dir * offset.current, dir * g.vx, max, width.current, full);
            if (target === 'full' && list[0]) {
                const first = list[0];
                settle(dir * Math.max(width.current, max), () => { first.onPress(); close(); });
            } else if (target === 'open') openFully();
            else close();
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderTerminate: () => close(),
    }), []); // eslint-disable-line react-hooks/exhaustive-deps

    function onLayout(e: LayoutChangeEvent) { width.current = e.nativeEvent.layout.width; }

    if (actions.length === 0) return <>{children}</>;

    return (
        <View style={s.wrap} onLayout={onLayout}>
            <View style={[s.actions, I18nManager.isRTL ? s.actionsRtl : null]} pointerEvents={open ? 'auto' : 'none'}>
                {actions.map(action => (
                    <Pressable
                        key={action.key}
                        accessibilityRole="button"
                        // Hidden from screen readers while closed: the row's own accessibility actions carry the full name. The button is
                        // named by its visible text, so it never duplicates the label of the row's own existing button.
                        accessibilityElementsHidden={!open}
                        importantForAccessibility={open ? 'yes' : 'no-hide-descendants'}
                        style={[s.action, s[action.tone ?? 'neutral']]}
                        onPress={() => { close(); action.onPress(); }}
                    >
                        <Text variant="callout" style={action.tone === 'neutral' || !action.tone ? s.neutralText : s.actionText}>{action.label}</Text>
                    </Pressable>
                ))}
            </View>
            <Animated.View
                style={[s.front, { transform: [{ translateX: x }] }]}
                {...(canSwipe ? responder.panHandlers : {})}
                accessibilityActions={canSwipe ? actions.map(a => ({ name: a.key, label: a.accessibilityLabel ?? a.label })) : undefined}
                onAccessibilityAction={canSwipe ? (e) => { actions.find(a => a.key === e.nativeEvent.actionName)?.onPress(); } : undefined}
            >
                {children}
            </Animated.View>
        </View>
    );
}

const sheets = themedStyles((p) => ({
    wrap: { overflow: 'hidden' },
    front: { backgroundColor: p.bg },
    actions: { position: 'absolute', top: 0, bottom: 0, right: 0, flexDirection: 'row-reverse' },
    actionsRtl: { right: undefined, left: 0, flexDirection: 'row' },
    action: { width: ACTION_WIDTH, alignItems: 'center', justifyContent: 'center' },
    danger: { backgroundColor: p.danger },
    accent: { backgroundColor: p.accent },
    neutral: { backgroundColor: p.surfacePressed },
    actionText: { color: '#ffffff' },
    neutralText: { color: p.textPrimary },
}));
