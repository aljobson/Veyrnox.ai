import { useEffect, useRef, useState } from 'react';
import { Modal, View } from 'react-native';
import { Text, Button, themedStyles, useThemedStyles } from './ui';
import { LegalSheetContent } from './legal/LegalSheet';
import { AI_CONSENT_TEXT } from '../lib/aiConsent';
import { aiConsent } from '../lib/aiConsentStore';
import { ds } from '../theme';

// Reading legal content must leave the gate's pending resolver untouched.
export function AiConsentHost() {
    const styles = useThemedStyles(sheets);
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
                <View style={styles.backdrop} onAccessibilityEscape={() => answer(false)}>
                    <View style={styles.card}>
                        <Text variant="title2">{AI_CONSENT_TEXT.title}</Text>
                        <Text accessibilityLanguage="en">{AI_CONSENT_TEXT.body}</Text>
                        <Button variant="tertiary" accessibilityRole="link" label={AI_CONSENT_TEXT.privacyLabel} onPress={() => setReading(true)} />
                        <Button label={AI_CONSENT_TEXT.agree} onPress={() => answer(true)} />
                        <Button variant="secondary" label={AI_CONSENT_TEXT.decline} onPress={() => answer(false)} />
                    </View>
                </View>}
        </Modal>
    );
}
const sheets = themedStyles(p => ({
    backdrop: { flex: 1, backgroundColor: p.scrim, justifyContent: 'center', padding: ds.space.lg },
    card: { backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: ds.radius.md, padding: ds.space.lg, gap: ds.space.md },
}));
