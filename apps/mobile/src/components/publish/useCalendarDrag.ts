import type { ElementRef } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions, type GestureResponderEvent, type View } from 'react-native';
import { droppedAt, dropTarget, type DropRect } from '../../lib/publishCalendarMove';
import type { CalendarPost } from '../../lib/publishCalendar';

export function measureDropTargets(refs: Map<string, ElementRef<typeof View>>, done: (rects: DropRect[]) => void) {
    const rects: DropRect[] = [];
    let left = refs.size;
    if (!left) done(rects);
    refs.forEach((ref, key) => ref.measureInWindow((x, y, width, height) => {
        rects.push({ key, x, y, width, height });
        if (--left === 0) done(rects);
    }));
}
export function useCalendarDrag(open: (post: CalendarPost, when: Date) => void, resetKey: string, posts: CalendarPost[] | null, measureTargets = measureDropTargets) {
    const [armed, setArmed] = useState<string | null>(null), [dropKey, setDropKey] = useState<string | null>(null);
    const owner = useRef<'none' | 'row' | 'wrapper'>('none');
    const held = useRef<CalendarPost | null>(null), rects = useRef<DropRect[]>([]), refs = useRef(new Map<string, ElementRef<typeof View>>());
    const measurement = useRef(0);
    const { width, height, fontScale } = useWindowDimensions();
    const cancelDrag = useCallback(() => {
        measurement.current++; owner.current = 'none'; held.current = null; rects.current = [];
        setArmed(null); setDropKey(null);
    }, []);
    useEffect(() => { cancelDrag(); }, [resetKey, width, height, fontScale, cancelDrag]);
    useEffect(() => { if (!posts || (held.current && !posts.some(p => p.id === held.current?.id))) cancelDrag(); }, [posts, cancelDrag]);
    useEffect(() => () => { measurement.current++; owner.current = 'none'; held.current = null; }, []);
    const dropRef = useCallback((key: string, ref: ElementRef<typeof View> | null) => { if (ref) refs.current.set(key, ref); else refs.current.delete(key); }, []);
    const measure = () => {
        const version = ++measurement.current;
        measureTargets(refs.current, value => { if (version === measurement.current && held.current) rects.current = value; });
    };
    const point = (event: GestureResponderEvent) => dropTarget(event.nativeEvent.pageX, event.nativeEvent.pageY, rects.current);
    const rowRefs = useRef(new Map<string, (ref: ElementRef<typeof View> | null) => void>());
    function rowRef(id: string) {
        if (!rowRefs.current.has(id)) rowRefs.current.set(id, ref => { if (!ref) { if (held.current?.id === id) cancelDrag(); rowRefs.current.delete(id); } });
        return rowRefs.current.get(id)!;
    }
    return {
        armed, dropKey, dropRef, measure, cancelDrag, rowRef,
        rowProps: (post: CalendarPost) => ({
            delayLongPress: 400,
            onLongPress: () => { held.current = post; owner.current = 'row'; setArmed(post.id); measure(); },
            onPressOut: () => { if (held.current?.id === post.id && owner.current === 'row') cancelDrag(); },
        }),
        responderProps: (post: CalendarPost) => ({
            onMoveShouldSetResponderCapture: () => held.current?.id === post.id,
            onResponderGrant: () => { owner.current = 'wrapper'; },
            onResponderTerminationRequest: () => false,
            onResponderMove: (event: GestureResponderEvent) => setDropKey(point(event)),
            onResponderRelease: (event: GestureResponderEvent) => {
                const key = point(event), source = held.current;
                cancelDrag();
                const when = key && source ? droppedAt(source, key) : null;
                if (source && when) open(source, when);
            },
            onResponderTerminate: cancelDrag, onResponderReject: cancelDrag,
        }),
    };
}
