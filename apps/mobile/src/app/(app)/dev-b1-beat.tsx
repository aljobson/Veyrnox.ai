import { Redirect, Stack } from 'expo-router';
import * as Device from 'expo-device';
import { Platform, Text, View } from 'react-native';
import { BeatEngineSpikeHarness } from '../../components/dev/BeatEngineSpikeHarness';
import { B1_FLAG, spikeEnabled } from '../../lib/beatEngineSpike';

// Hidden spike route (docs/mobile/spikes/B1-BEAT-ENGINE-WEBVIEW.md). Nothing links here: open it with
// ai.veyrnox.app://dev-b1-beat on a build made with EXPO_PUBLIC_DEV_B1_BEAT_SPIKE=1. Without the flag a development
// build shows a note and a release build sends the address Home. The flag must be a direct property read (build-time inlining).
export default function DevB1Beat() {
    const on = spikeEnabled(process.env.EXPO_PUBLIC_DEV_B1_BEAT_SPIKE);
    if (!on && !__DEV__) return <Redirect href="/" />;
    return (
        <>
            <Stack.Screen options={{ title: 'B1 beat engine spike' }} />
            {on ? (
                <BeatEngineSpikeHarness deviceLabel={`${Device.modelName ?? 'unknown'} ${Platform.OS} ${Platform.Version}`} />
            ) : (
                <View style={{ flex: 1, padding: 24 }}>
                    <Text>{`Spike B1 is off in this build. Set ${B1_FLAG}=1.`}</Text>
                </View>
            )}
        </>
    );
}
