import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

// True while the on-screen keyboard is up. Chat screens use it to drop secondary chrome so the
// message list keeps most of the space above the keyboard.
export function useKeyboardOpen(): boolean {
    const [open, setOpen] = useState(Keyboard.isVisible());
    useEffect(() => {
        const show = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
        const hide = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
        return () => { show.remove(); hide.remove(); };
    }, []);
    return open;
}
