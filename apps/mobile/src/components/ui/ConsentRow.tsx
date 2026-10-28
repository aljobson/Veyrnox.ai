import { rawText } from '../../lib/i18n/translate';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { LegalSheet } from '../legal/LegalSheet';
import type { LegalDoc } from '../../lib/legal';
import { MIN_AGE } from '../../lib/account';
import { t } from '../../lib/i18n';
import { english } from '../../lib/i18n/binding';
import { Checkbox } from './Checkbox';
import { Button } from './Button';
import { Text } from './Text';
import { themedStyles, useThemedStyles } from './AppearanceContext';

export function ConsentRow({ agreed, onChange }: { agreed: boolean; onChange: (value: boolean) => void }) {
    const [document, setDocument] = useState<LegalDoc | null>(null);
    const styles = useThemedStyles(sheets);
    const label = english('signIn.agree', { age: MIN_AGE, terms: english('label.Terms'), privacy: english('chrome.privacyPolicy') });
    return (<>
        <View style={styles.row}>
            <Checkbox checked={agreed} onChange={onChange} accessibilityLabel={rawText(label)} accessibilityLanguage="en" />
            <View style={styles.copy}>
                <Pressable onPress={() => onChange(!agreed)} accessibilityRole="button" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.sentence}>
                    <Text variant="footnote" tone="secondary" accessible={false}>{label}</Text>
                </Pressable>
                <View style={styles.links}>
                    <Button variant="tertiary" size="md" accessibilityRole="link" label={t('label.Terms')} onPress={() => setDocument('terms')} />
                    <Button variant="tertiary" size="md" accessibilityRole="link" label={t('chrome.privacyPolicy')} onPress={() => setDocument('privacy')} />
                </View>
            </View>
        </View>
        <LegalSheet doc={document} onClose={() => setDocument(null)} />
    </>);
}
const sheets = themedStyles(() => ({
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    copy: { flex: 1 },
    sentence: { minHeight: 44, justifyContent: 'center' },
    links: { flexDirection: 'row', flexWrap: 'wrap' },
}));
