import { useState } from 'react';
import { LegalSheet } from '../legal/LegalSheet';
import type { LegalDoc } from '../../lib/legal';
import { StyleSheet } from 'react-native';
import { MIN_AGE } from '../../lib/account';
import { splitSlots, t } from '../../lib/i18n';
import { Checkbox } from './Checkbox';
import { Text } from './Text';
export function ConsentRow({ agreed, onChange }: { agreed: boolean; onChange: (value: boolean) => void }) {
    const [document, setDocument] = useState<LegalDoc | null>(null);
    return (<>
        <Checkbox
            checked={agreed}
            onChange={onChange}
            accessibilityLabel={t('signIn.agree', { age: MIN_AGE, terms: t('label.Terms'), privacy: t('chrome.privacyPolicy') })}
            accessibilityActions={[
                { name: 'terms', label: t('signIn.openTerms') },
                { name: 'privacy', label: t('signIn.openPrivacy') },
            ]}
            onAccessibilityAction={(e) => setDocument(e.nativeEvent.actionName === 'terms' ? 'terms' : 'privacy')}
        >
            <Text variant="footnote" tone="secondary">
                {splitSlots(t('signIn.agree', { age: MIN_AGE }), ['terms', 'privacy']).map((piece, i) =>
                    typeof piece === 'string' ? (
                        piece
                    ) : (
                        <Text
                            key={i}
                            variant="footnote"
                            style={styles.link}
                            accessibilityRole="link"
                            onPress={(event) => { event.stopPropagation(); setDocument(piece.slot === 'terms' ? 'terms' : 'privacy'); }}
                        >
                            {t(piece.slot === 'terms' ? 'label.Terms' : 'chrome.privacyPolicy')}
                        </Text>
                    ),
                )}
            </Text>
        </Checkbox>
        <LegalSheet doc={document} onClose={() => setDocument(null)} />
    </>
    );
}
const styles = StyleSheet.create({ link: { textDecorationLine: 'underline' } });
