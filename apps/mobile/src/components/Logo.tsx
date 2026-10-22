import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, type Palette } from '../theme';

// The Veyrnox.ai mark (the aqua V from the web app's icon) with the VEYRNOX.ai wordmark.
export function Logo({ size = 28, wordmark = true, palette = colors }: { size?: number; wordmark?: boolean; palette?: Palette }) {
    return (
        <View style={styles.row} accessibilityRole="header" accessibilityLabel="Veyrnox.ai">
            <Image source={require('../../assets/logo-mark.png')} style={{ width: size, height: size * 0.94 }} contentFit="contain" />
            {wordmark ? (
                // The wordmark is part of the brand mark, a fixed-size picture of the name beside a fixed-size icon, so it does not follow
                // the system text size (the row is read as "Veyrnox.ai" by its label).
                <Text style={[styles.word, { color: palette.text, fontSize: size * 0.62 }]} maxFontSizeMultiplier={1}>
                    VEYRNOX<Text style={{ color: palette.accent }}>.ai</Text>
                </Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    word: { fontFamily: fonts.displayHeavy, letterSpacing: -0.2 },
});
