import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Button, Text, TextField, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { TEMPLATE_CLIP_PROMPT, templateClipPhotoPrompt, validTemplateClipPrompt } from '../../../../../lib/templateClipPrompt.mjs';

// Native TextInput keeps selection, dictation and IME behavior. The reference row supplies the chips.
export function TemplateClipComposer({ poster, prompt, attached, onChange, picker }: {
    poster: string | null; prompt: string; attached: boolean; onChange: (value: string) => void; picker: ReactNode;
}) {
    const styles = useThemedStyles(sheets);
    return <View style={styles.box}>
        <View style={styles.row}>
            <View style={styles.video} accessible accessibilityLabel={t('templateClip.videoName')}>
                {poster ? <Image source={{ uri: poster }} contentFit="cover" style={styles.thumb} /> : null}
                <Text variant="caption">@video1</Text>
            </View>
            <View style={styles.photo}>{picker}</View>
        </View>
        <TextField label={t('templateClip.prompt')} accessibilityLabel={t('templateClip.prompt')} value={prompt} onChangeText={onChange} multiline scrollEnabled />
        <Text variant="caption">{prompt.length} / 2000</Text>
        <Button variant="secondary" label={t('templateClip.reset')} onPress={() => onChange(templateClipPhotoPrompt(TEMPLATE_CLIP_PROMPT, attached))} />
        {!validTemplateClipPrompt(prompt) ? <Text tone="danger" accessibilityLiveRegion="polite">{t(attached ? 'templateClip.invalid' : 'templateClip.addPhoto')}</Text> : null}
    </View>;
}
const sheets = themedStyles(p => ({
    box: { gap: 12 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    video: { gap: 8, padding: 12, borderRadius: 14, backgroundColor: p.surface },
    photo: { flexGrow: 1, flexBasis: 200, minWidth: 0 }, thumb: { width: 64, height: 64, borderRadius: 10 },
}));
