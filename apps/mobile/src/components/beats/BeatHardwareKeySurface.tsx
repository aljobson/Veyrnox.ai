import { useRef, useState, type ComponentType, type ReactNode } from 'react';
import { View, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import type { PianoHardwareKeyEvent } from '../../lib/beatNative/pianoHardwareKeys';

type NativeProps = ViewProps & {
    active: boolean;
    focusToken: number;
    onKeyCommand(event: NativeSyntheticEvent<PianoHardwareKeyEvent>): void;
};

let NativeKeySurface: ComponentType<NativeProps> | null = null;
try { NativeKeySurface = requireNativeViewManager<NativeProps>('VeyrnoxBeatKeyboard'); } catch { NativeKeySurface = null; }

export function BeatHardwareKeySurface({ children, active = true, onKeyCommand }: { children: ReactNode; active?: boolean; onKeyCommand(event: PianoHardwareKeyEvent): void }) {
    const [focusToken, setFocusToken] = useState(0), latest = useRef(onKeyCommand); latest.current = onKeyCommand;
    return <View testID="beat-hardware-key-surface" onTouchStart={() => setFocusToken(value => value + 1)}>
        {children}
        {NativeKeySurface && <NativeKeySurface testID="beat-hardware-key-native" pointerEvents="none" active={active} focusToken={focusToken}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0.01 }} onKeyCommand={event => latest.current(event.nativeEvent)} />}
    </View>;
}
