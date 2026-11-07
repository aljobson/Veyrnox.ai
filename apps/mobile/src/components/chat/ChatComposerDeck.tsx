import { rawText } from '../../lib/i18n/translate';
import { useEffect, useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, View } from 'react-native';
import { cleanOptions, thinkingExtra, webExtra, type ChatModel, type ReplyOptions } from '../../lib/chat';
import type { ChatImage } from '../../lib/chatAttach';
import { plural, t } from '../../lib/i18n';
import type { Kind } from '../../lib/media';
import { radius } from '../../theme';
import { Button, Chip, Text, TextField, themedStyles, useThemedStyles } from '../ui';
import { AttachStrip, AttachThumbs } from './AttachStrip';
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

// With the keyboard open the whole deck (modes, model, attach strip, text box) is taller than
// the space above the keyboard, so the text box ends up under it. While typing, show only the input row.
function useKeyboardOpen(): boolean {
    const [open, setOpen] = useState(Keyboard.isVisible());
    useEffect(() => {
        const show = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
        const hide = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
        return () => { show.remove(); hide.remove(); };
    }, []);
    return open;
}

export function ChatComposerDeck(props: Props) {
    const styles = useThemedStyles(sheets);
    const typing = useKeyboardOpen();
    const [sheet, setSheet] = useState(false);
    const thinking = thinkingExtra(props.model);
    const web = webExtra(props.model);
    const chosen = cleanOptions(props.model, props.options);
    const pick = (action: () => void) => () => { setSheet(false); action(); };
    return (
        <View>
            <View style={styles.deck} accessibilityLabel={t('chat.composer.label')}>
                {typing ? null : <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.setupRow} accessibilityLabel={t('chat.composer.setup')}>
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
                </ScrollView>}
                <AttachThumbs items={props.images} disabled={props.sending} onRemove={props.onRemoveImage} />
                <View style={styles.inputRow}>
                    <Button variant="secondary" size="md" icon="plus" iconOnly label={t('chat.make.title')} accessibilityRole="button" accessibilityLabel={t('chat.make.title')}
                        disabled={props.sending} containerStyle={styles.plus} onPress={() => { Keyboard.dismiss(); setSheet(true); }} />
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
            {typing || props.draft.length > 0 ? null : <Text variant="caption" tone="tertiary" style={styles.policy}>
                <Text variant="caption" tone="warning">{props.free ? t('chatDepth.free') : plural('chat.perReply', props.price)}</Text> {t('chat.composer.policy')}
            </Text>}
            <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => setSheet(false)}>
                <Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel={t('chat.make.close')} onPress={() => setSheet(false)} />
                <View style={styles.sheet} onAccessibilityEscape={() => setSheet(false)}>
                    <Text variant="title3" accessibilityRole="header">{t('chat.make.title')}</Text>
                    <View style={styles.types} accessibilityRole="tablist">
                        {TYPES.map((item) => (
                            <Chip key={item.id} accessibilityRole="tab" selected={item.id === 'chat'}
                                icon={item.id} label={t(item.key)} onPress={() => item.id !== 'chat' ? pick(() => props.onMake(item.id))() : setSheet(false)} />
                        ))}
                    </View>
                    {props.imageExtra !== null ? (
                        <AttachStrip hideThumbs items={props.images} extra={props.imageExtra} max={props.maxImages} disabled={props.sending}
                            onLibrary={pick(props.onLibrary)} onPhotos={pick(props.onPhotos)} onVideo={props.onVideo ? pick(props.onVideo) : undefined} onRemove={props.onRemoveImage} />
                    ) : null}
                    <Button variant="tertiary" size="md" label={t('chat.make.close')} onPress={() => setSheet(false)} />
                </View>
            </Modal>
        </View>
    );
}

const sheets = themedStyles((p) => ({
    deck: { overflow: 'hidden', borderRadius: 28, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1 },
    setupRow: { minHeight: 48, gap: 6, alignItems: 'center', paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: p.borderSubtle },
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 8, paddingVertical: 7 },
    plus: { minWidth: 44 },
    field: { flex: 1 },
    backdrop: { flex: 1, backgroundColor: p.scrim },
    sheet: { backgroundColor: p.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 16, paddingBottom: 28, gap: 12 },
    types: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    input: { minHeight: 44, maxHeight: 132 },
    action: { maxWidth: 150 },
    sendPrice: { textAlign: 'center', marginTop: 4 },
    policy: { paddingHorizontal: 5, paddingTop: 5 },
}));
