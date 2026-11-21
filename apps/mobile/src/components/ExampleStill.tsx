import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';
import { rawText } from '../lib/i18n/translate';
import { t } from '../lib/i18n';

export function ExampleStill({ uri, title }: { uri: string; title: string }) {
    return <Image source={{ uri }} style={styles.media} contentFit="contain" accessibilityLabel={rawText(t('features.example', { value1: title }))} accessibilityIgnoresInvertColors />;
}
const styles = StyleSheet.create({ media: { width: '100%', height: 260, backgroundColor: '#050506' } });
