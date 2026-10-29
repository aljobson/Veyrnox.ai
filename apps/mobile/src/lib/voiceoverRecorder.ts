import { Platform } from 'react-native';
import { AudioQuality, IOSOutputFormat, type RecordingOptions } from 'expo-audio';

export const VOICEOVER_AVAILABLE = Platform.OS === 'ios';
export const VOICEOVER_OPTIONS: RecordingOptions = {
    extension: '.wav', sampleRate: 16000, numberOfChannels: 1, bitRate: 256000, isMeteringEnabled: true,
    ios: { outputFormat: IOSOutputFormat.LINEARPCM, audioQuality: AudioQuality.MAX, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
    // Required by the shared type; recording is offered only on iOS.
    android: { outputFormat: 'mpeg4', audioEncoder: 'aac' }, web: {},
};
export { useAudioRecorder, useAudioRecorderState, useAudioPlayer, requestRecordingPermissionsAsync, getRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
