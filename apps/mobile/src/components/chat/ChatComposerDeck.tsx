import { rawText } from '../../lib/i18n/translate';
import { ScrollView, View } from 'react-native';
import { cleanOptions, thinkingExtra, webExtra, type ChatModel, type ReplyOptions } from '../../lib/chat';
import type { ChatImage } from '../../lib/chatAttach';
import { plural, t } from '../../lib/i18n';
import type { Kind } from '../../lib/media';
import { Button, Chip, Text, TextField, themedStyles, useThemedStyles } from '../ui';
import { AttachStrip } from './AttachStrip';
import { ReplyOptionChip } from './ReplyOptionChip';

interface Props {
    readonly free?: boolean;
    readonly onVideo?: () => void;
    readonly model: ChatModel;
    readonly options: ReplyOptions;
    readonly draft: string;
    readonly price: number;
    readonly canSend: boolean;
    readonly sending: boolean;
    readonly stopping: boolean;
    readonly images: readonly ChatImage[];
    readonly imageExtra: number | null;
    readonly maxImages: number;
    readonly placeholder: string;
    readonly onDraft: (value: string) => void;
    readonly onModel: () => void;
    readonly onOptions: (value: ReplyOptions) => void;
    readonly onLibrary: () => void;
    readonly onPhotos: () => void;
    readonly onRemoveImage: (id: string) => void;
    readonly onMake: (kind: Kind) => void;
    readonly onSend: () => void;
    readonly onStop: () => void;
}

const TYPES = [
    { id: 'chat', key: 'chat.composer.chat' },
    { id: 'image', key: 'chat.make.kind.image' },
    { id: 'video', key: 'chat.make.kind.video' },
    { id: 'audio', key: 'chat.make.kind.audio' },
] as const;

export function ChatComposerDeck(props: Props) {
    const styles = useThemedStyles(sheets);
    const thinking = thinkingExtra(props.model);
    const web = webExtra(props.model);
    const chosen = cleanOptions(props.model, props.options);
    return (
        <View>
            <View style={styles.deck} accessibilityLabel={t('chat.composer.label')}>
                <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeRow} accessibilityRole="tablist">
                    {TYPES.map((item) => (
                        <Chip key={item.id} accessibilityRole="tab" selected={item.id === 'chat'}
                            icon={item.id} label={t(item.key)} onPress={() => item.id !== 'chat' && props.onMake(item.id)} />
                    ))}
                </ScrollView>
                <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.setupRow} accessibilityLabel={t('chat.composer.setup')}>
                    <Chip icon="cpu" trailingIcon="caretDown" label={props.model.name}
                        accessibilityRole="button" accessibilityLabel={rawText(`${t('chat.model.change')}: ${props.model.name}, ${plural('chat.perReply', props.model.credits_per_reply)}`)}
                        disabled={props.sending} onPress={props.onModel} />
                    {thinking !== null ? (
                        <>
                            <ReplyOptionChip label={t('chat.opt.standard')} selected={!chosen.thinking} disabled={props.sending} onPress={() => props.onOptions({ ...chosen, thinking: false })} />
                            <ReplyOptionChip label={t('chat.opt.thinking')} extra={thinking} selected={chosen.thinking} disabled={props.sending} onPress={() => props.onOptions({ ...chosen, thinking: true })} />
                        </>
                    ) : null}
                    {web !== null ? <ReplyOptionChip label={t('chat.opt.web')} extra={web} selected={chosen.web} toggle disabled={props.sending} onPress={() => props.onOptions({ ...chosen, web: !chosen.web })} /> : null}
                </ScrollView>
                {props.imageExtra !== null ? (
                    <AttachStrip items={props.images} extra={props.imageExtra} max={props.maxImages} disabled={props.sending} embedded onLibrary={props.onLibrary} onPhotos={props.onPhotos} onVideo={props.onVideo} onRemove={props.onRemoveImage} />
                ) : null}
                <View style={styles.inputRow}>
                    <TextField containerStyle={styles.field} style={styles.input} value={props.draft} onChangeText={props.onDraft}
                        placeholder={props.placeholder} accessibilityLabel={t('chat.composer.message')} multiline maxLength={8000} />
                    {props.sending ? (
                        <Button variant="secondary" size="md" label={props.stopping ? '…' : t('chat.stop')}
                            accessibilityRole="button" accessibilityLabel={rawText(props.stopping ? t('chat.stopping') : t('chat.stopLabel'))}
                            disabled={props.stopping} containerStyle={styles.action} onPress={props.onStop} />
                    ) : (
                        <View style={styles.action}>
                            <Button variant="primary" size="md" label={t('chat.send')} accessibilityRole="button"
                                accessibilityLabel={rawText(props.free ? t('chatDepth.sendFree') : plural('chat.sendPrice', props.price))} disabled={!props.canSend} onPress={props.onSend} />
                            <Text variant="caption" tone="warning" style={styles.sendPrice}>{props.free ? t('chatDepth.free') : plural('chat.sendPriceShort', props.price)}</Text>
                        </View>
                    )}
                </View>
            </View>
            {props.images.some(image => image.video) ? <Text variant="caption" tone="tertiary">{t('chatDepth.videoFrames')}</Text> : null}
            <Text variant="caption" tone="tertiary" style={styles.policy}>
                <Text variant="caption" tone="warning">{props.free ? t('chatDepth.free') : plural('chat.perReply', props.price)}</Text> {t('chat.composer.policy')}
            </Text>
        </View>
    );
}

const sheets = themedStyles((p) => ({
    deck: { overflow: 'hidden', borderRadius: 28, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1 },
    typeRow: { minHeight: 48, gap: 4, alignItems: 'center', paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: p.borderSubtle },
    setupRow: { minHeight: 52, gap: 6, alignItems: 'center', paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: p.borderSubtle },
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 8, paddingVertical: 7 },
    field: { flex: 1 },
    input: { minHeight: 44, maxHeight: 132 },
    action: { maxWidth: 150 },
    sendPrice: { textAlign: 'center', marginTop: 4 },
    policy: { paddingHorizontal: 5, paddingTop: 5 },
}));
