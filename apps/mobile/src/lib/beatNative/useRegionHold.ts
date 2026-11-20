import { useEffect, useMemo, useRef } from 'react';
import { PanResponder, type GestureResponderEvent } from 'react-native';
import { t } from '../i18n';

type Options<T> = {
    value: (dx: number, dy: number, originY: number) => T;
    preview: (value: T | null) => void;
    lock: (held: boolean) => void;
    commit: (value: T) => void;
    select: () => void;
    announce: (message: string) => void;
};
/** Raw events own the lifetime, including stationary touches which never become responders. */
export function useRegionHold<T>(options: Options<T>) {
    const latest = useRef(options); latest.current = options;
    const sequence = useRef(0);
    const active = useRef<null | { id: number; touch: number; x: number; y: number; originY: number; held: boolean; moved: boolean; value?: T; timer: ReturnType<typeof setTimeout>; options: Options<T> }>(null);
    const handlers = useMemo(() => {
        const finish = (kind: 'commit' | 'cancel' | 'select', id = active.current?.id) => {
            const gesture = active.current;
            if (!gesture || gesture.id !== id) return;
            active.current = null;
            clearTimeout(gesture.timer);
            gesture.options.preview(null); gesture.options.lock(false);
            if (kind === 'cancel') { if (gesture.held) gesture.options.announce(t('beat.drag.cancelled')); return; }
            if (kind === 'commit' && gesture.held && gesture.moved && gesture.value !== undefined) gesture.options.commit(gesture.value);
            else if (!gesture.moved) gesture.options.select();
        };
        const begin = (event: GestureResponderEvent) => {
            event.stopPropagation();
            if (active.current) return;
            const { pageX, pageY, identifier, locationY } = event.nativeEvent;
            const id = ++sequence.current;
            const frozen = latest.current;
            const timer = setTimeout(() => {
                const gesture = active.current;
                if (!gesture || gesture.id !== id) return;
                gesture.held = true;
                gesture.value = frozen.value(0, 0, locationY ?? 44);
                frozen.preview(gesture.value); frozen.lock(true); frozen.announce(t('beat.drag.moving'));
            }, 350);
            active.current = { id, touch: identifier, x: pageX, y: pageY, originY: locationY ?? 44, held: false, moved: false, timer, options: frozen };
        };
        const move = (event: GestureResponderEvent) => {
            const gesture = active.current;
            if (!gesture || event.nativeEvent.identifier !== gesture.touch) return;
            const dx = event.nativeEvent.pageX - gesture.x, dy = event.nativeEvent.pageY - gesture.y;
            if (!gesture.held) {
                if (Math.hypot(dx, dy) > 8) finish('cancel', gesture.id);
                return;
            }
            if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
            gesture.moved = true; gesture.value = gesture.options.value(dx, dy, gesture.originY); gesture.options.preview(gesture.value);
        };
        const end = (event: GestureResponderEvent) => {
            if (active.current?.touch === event.nativeEvent.identifier) finish('commit');
        };
        const pan = PanResponder.create({
            onStartShouldSetPanResponder: () => false,
            onMoveShouldSetPanResponder: event => { move(event); return !!active.current?.held; },
            onMoveShouldSetPanResponderCapture: event => { move(event); return !!active.current?.held; },
            onPanResponderMove: move,
            onPanResponderRelease: end,
            onPanResponderTerminationRequest: () => !active.current?.held,
            onPanResponderTerminate: () => finish('cancel'),
            onPanResponderReject: () => finish('cancel'),
            onShouldBlockNativeResponder: () => !!active.current?.held,
        });
        return { ...pan.panHandlers, onTouchStart: begin, onTouchMove: move, onTouchEnd: end,
            onTouchCancel: () => finish('cancel'), cancel: () => finish('cancel') };
    }, []);
    useEffect(() => () => handlers.cancel(), [handlers]);
    const { cancel: _cancel, ...touchHandlers } = handlers;
    return touchHandlers;
}
