import { Redirect, Stack } from 'expo-router';
import * as Device from 'expo-device';
import { Platform, Text, View } from 'react-native';
import { NativeBeatEngineHarness } from '../../components/dev/NativeBeatEngineHarness';
import { N0_FLAG, n0Enabled } from '../../lib/beatNative/session';

// Hidden slice-N0 route (docs/mobile/spikes/N0-NATIVE-ENGINE.md). Nothing links here: open it with
// ai.veyrnox.app://dev-n0-beat on a build made with EXPO_PUBLIC_DEV_N0_BEAT_SPIKE=1. Without the flag a development
// build shows a note and a release build sends the address Home. The flag must be a direct property read (build-time inlining).
export default function DevN0Beat() {
    const on = n0Enabled(process.env.EXPO_PUBLIC_DEV_N0_BEAT_SPIKE);
    if (!on && !__DEV__) return <Redirect href="/" />;
    return (
        <>
            <Stack.Screen options={{ title: 'N0 native beat engine' }} />
            {on ? (
                <NativeBeatEngineHarness deviceLabel={`${Device.modelName ?? 'unknown'} ${Platform.OS} ${Platform.Version}`} />
            ) : (
                <View style={{ flex: 1, padding: 24 }}>
                    <Text>{`Slice N0 is off in this build. Set ${N0_FLAG}=1.`}</Text>
                </View>
            )}
        </>
    );
}
