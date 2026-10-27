import * as WebBrowser from 'expo-web-browser';
import { StyleSheet } from 'react-native';
import { LEGAL_LINKS, MIN_AGE } from '../../lib/account';
import { splitSlots, t } from '../../lib/i18n';
import { Checkbox } from './Checkbox';
import { Text } from './Text';
export function ConsentRow({ agreed, onChange }: { agreed: boolean; onChange: (value: boolean) => void }) {
    return (
        <Checkbox
            checked={agreed}
            onChange={onChange}
            accessibilityLabel={t('signIn.agree', { age: MIN_AGE, terms: t('label.Terms'), privacy: t('chrome.privacyPolicy') })}
            accessibilityActions={[
                { name: 'terms', label: t('signIn.openTerms') },
                { name: 'privacy', label: t('signIn.openPrivacy') },
            ]}
            onAccessibilityAction={(e) => void WebBrowser.openBrowserAsync(LEGAL_LINKS[e.nativeEvent.actionName === 'terms' ? 0 : 1].url)}
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
                            onPress={() => WebBrowser.openBrowserAsync(LEGAL_LINKS[piece.slot === 'terms' ? 0 : 1].url)}
                        >
                            {t(piece.slot === 'terms' ? 'label.Terms' : 'chrome.privacyPolicy')}
                        </Text>
                    ),
                )}
            </Text>
        </Checkbox>
    );
}
const styles = StyleSheet.create({ link: { textDecorationLine: 'underline' } });
