import { useCallback, useEffect, useRef, type ComponentRef } from 'react';
import { Keyboard, ScrollView, TextInput, type ScrollViewProps } from 'react-native';
import { KeyboardFocusContext } from './KeyboardFocusContext';

// The shared KeyboardScreen resizes for the real header. Scroll the actual focused
// native input as well: resizing alone does not reveal a field far down a form. A drag closes the keyboard: a multiline
// prompt's Return key adds a line, so otherwise nothing closes it on a form like Create.
export function KeyboardFormScrollView(props: ScrollViewProps) {
    const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
    const frame = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const reveal = useCallback(() => {
        if (frame.current) clearTimeout(frame.current);
        frame.current = setTimeout(() => {
            const field = TextInput.State.currentlyFocusedInput();
            if (field && Keyboard.isVisible()) scroll.current?.scrollResponderScrollNativeHandleToKeyboard(field, 16, true);
        }, 0);
    }, []);
    useEffect(() => {
        const shown = Keyboard.addListener('keyboardDidShow', reveal);
        const changed = Keyboard.addListener('keyboardDidChangeFrame', reveal);
        return () => { shown.remove(); changed.remove(); if (frame.current) clearTimeout(frame.current); };
    }, [reveal]);
    return <KeyboardFocusContext value={reveal}>
        <ScrollView keyboardDismissMode="on-drag" {...props} ref={scroll} keyboardShouldPersistTaps="handled" onLayout={event => { props.onLayout?.(event); reveal(); }} />
    </KeyboardFocusContext>;
}
