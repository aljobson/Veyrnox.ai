import { useRef, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { Keyboard, View, type LayoutChangeEvent, type ScrollView } from 'react-native';
import { useReducedMotion } from '../ui/useReducedMotion';

// Space kept above the result card when it is scrolled into view.
export const RESULT_REVEAL_MARGIN = 12;

// Create's result card sits above the prompt. When a job starts (also after the AI-consent sheet) the card is laid out
// for the first time: lower the keyboard and scroll the card into view. Later size changes (the file arriving) do not
// scroll again.
export function RevealOnFirstLayout({ scroll, children }: { scroll: RefObject<ComponentRef<typeof ScrollView> | null>; children: ReactNode }) {
    const reduced = useReducedMotion();
    const revealed = useRef(false);
    const layout = (event: LayoutChangeEvent) => {
        if (revealed.current) return;
        revealed.current = true;
        Keyboard.dismiss();
        scroll.current?.scrollTo({ y: Math.max(0, event.nativeEvent.layout.y - RESULT_REVEAL_MARGIN), animated: !reduced });
    };
    return <View onLayout={layout}>{children}</View>;
}
