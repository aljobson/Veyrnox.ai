import { Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { EditorSpikeHarness } from '../../components/dev/EditorSpikeHarness';
import { S1_FLAG, spikeEnabled } from '../../lib/editorSpike';
import { colors } from '../../theme';

// Hidden spike route (docs/mobile/spikes/S1-editor-export.md). Nothing links here: open it with
// ai.veyrnox.app://dev-s1-editor on a build made with EXPO_PUBLIC_DEV_S1_EDITOR_SPIKE=1. Without the flag it shows a note.
// EXPO_PUBLIC_ values are inlined at build time, so the flag must be a direct property read.
export default function DevS1Editor() {
    const on = spikeEnabled(process.env.EXPO_PUBLIC_DEV_S1_EDITOR_SPIKE);
    return (
        <>
            <Stack.Screen options={{ title: 'S1 editor spike' }} />
            {on ? (
                <EditorSpikeHarness />
            ) : (
                <View style={{ flex: 1, padding: 24, backgroundColor: colors.background }}>
                    <Text style={{ color: colors.body }}>{`Spike S1 is off in this build (${S1_FLAG} is not 1).`}</Text>
                </View>
            )}
        </>
    );
}
