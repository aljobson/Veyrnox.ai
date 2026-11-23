import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { Text, Button, themedStyles, useThemedStyles } from './ui';
import { LegalSheetContent } from './legal/LegalSheet';
import { AI_CONSENT_TEXT } from '../lib/aiConsent';
import { aiConsent } from '../lib/aiConsentStore';
import { ds } from '../theme';
import { modalSafePadding } from '../lib/modalLayout';
import { useOptionalSafeAreaInsets } from '../lib/safeArea';

// Reading legal content must leave the gate's pending resolver untouched.
export function AiConsentHost() {
    const styles = useThemedStyles(sheets);
    const insets = useOptionalSafeAreaInsets();
    const [reading, setReading] = useState(false);
    const [open, setOpen] = useState(false);
    const resolver = useRef<((agreed: boolean) => void) | null>(null);
    useEffect(() => {
        aiConsent.setPrompter(() => new Promise<boolean>(resolve => {
            resolver.current = resolve;
            setReading(false);
            setOpen(true);
        }));
        return () => {
            aiConsent.setPrompter(null);
            resolver.current?.(false);
        };
    }, []);
    function answer(agreed: boolean) {
        setReading(false);
        setOpen(false);
        resolver.current?.(agreed);
        resolver.current = null;
    }
    return (
        <Modal visible={open} transparent animationType="none" onRequestClose={() => reading ? setReading(false) : answer(false)} accessibilityViewIsModal>
            {reading ? <LegalSheetContent doc="privacy" onClose={() => setReading(false)} /> :
                <View style={[styles.backdrop, modalSafePadding(insets, ds.space.lg)]} onAccessibilityEscape={() => answer(false)}>
                    <View style={styles.card}>
                        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                            <Text variant="title2">{AI_CONSENT_TEXT.title}</Text>
                            <Text accessibilityLanguage="en">{AI_CONSENT_TEXT.body}</Text>
                            <Button variant="tertiary" accessibilityRole="link" label={AI_CONSENT_TEXT.privacyLabel} onPress={() => setReading(true)} />
                            <Button label={AI_CONSENT_TEXT.agree} onPress={() => answer(true)} />
                            <Button variant="secondary" label={AI_CONSENT_TEXT.decline} onPress={() => answer(false)} />
                        </ScrollView>
                    </View>
                </View>}
        </Modal>
    );
}
const sheets = themedStyles(p => ({
    backdrop: { flex: 1, backgroundColor: p.scrim, justifyContent: 'center', alignItems: 'center' },
    card: { width: '100%', maxWidth: 560, maxHeight: '100%', overflow: 'hidden', backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: ds.radius.md },
    content: { padding: ds.space.lg, gap: ds.space.md },
}));
