import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { AI_CONSENT_TEXT } from '../lib/aiConsent';
import { aiConsent } from '../lib/aiConsentStore';
import { LEGAL_LINKS } from '../lib/account';
import { colors } from '../theme';

// Mounted once in the signed-in layout. It is the screen the consent gate asks on.
export function AiConsentHost() {
    const [open, setOpen] = useState(false);
    const resolver = useRef<((agreed: boolean) => void) | null>(null);

    useEffect(() => {
        aiConsent.setPrompter(
            () =>
                new Promise<boolean>((resolve) => {
                    resolver.current = resolve;
                    setOpen(true);
                }),
        );
        return () => {
            aiConsent.setPrompter(null);
            resolver.current?.(false);
        };
    }, []);

    function answer(agreed: boolean) {
        setOpen(false);
        resolver.current?.(agreed);
        resolver.current = null;
    }

    return (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => answer(false)} accessibilityViewIsModal>
            <View style={styles.backdrop}>
                <View style={styles.card}>
                    <Text accessibilityRole="header" style={styles.title}>
                        {AI_CONSENT_TEXT.title}
                    </Text>
                    <Text style={styles.body}>{AI_CONSENT_TEXT.body}</Text>
                    <Pressable accessibilityRole="link" style={styles.linkRow} onPress={() => WebBrowser.openBrowserAsync(LEGAL_LINKS[1].url)}>
                        <Text style={styles.link}>{AI_CONSENT_TEXT.privacyLabel}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" style={styles.primary} onPress={() => answer(true)}>
                        <Text style={styles.primaryText}>{AI_CONSENT_TEXT.agree}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => answer(false)}>
                        <Text style={styles.secondaryText}>{AI_CONSENT_TEXT.decline}</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 },
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 20, gap: 14 },
    title: { color: colors.text, fontSize: 20, fontWeight: '700' },
    body: { color: colors.body, fontSize: 15, lineHeight: 22 },
    linkRow: { minHeight: 44, justifyContent: 'center' },
    link: { color: colors.accent, fontSize: 15 },
    primary: { backgroundColor: colors.accent, borderRadius: 12, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
    primaryText: { color: colors.accentInk, fontSize: 16, fontWeight: '700' },
    secondary: { borderColor: colors.border, borderWidth: 1, borderRadius: 12, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
    secondaryText: { color: colors.text, fontWeight: '600' },
});
