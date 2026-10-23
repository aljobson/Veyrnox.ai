import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { cleanOptions, thinkingExtra, webExtra, type ChatModel, type ReplyOptions } from '../../lib/chat';
import type { ChatImage } from '../../lib/chatAttach';
import { plural, t } from '../../lib/i18n';
import type { Kind } from '../../lib/media';
import { colors, radius } from '../../theme';
import { AttachStrip } from './AttachStrip';

interface Props {
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

const TYPES: readonly { id: 'chat' | Kind; glyph: string; key: 'chat.composer.chat' | 'chat.make.kind.image' | 'chat.make.kind.video' | 'chat.make.kind.audio' }[] = [
    { id: 'chat', glyph: '◇', key: 'chat.composer.chat' },
    { id: 'image', glyph: '▧', key: 'chat.make.kind.image' },
    { id: 'video', glyph: '▷', key: 'chat.make.kind.video' },
    { id: 'audio', glyph: '◖', key: 'chat.make.kind.audio' },
];

// The mobile version of the web chat's command deck: media mode, reply setup, attachments and the priced action remain
// one visual object. It keeps every decision visible before a reply or generation can spend credits.
export function ChatComposerDeck(props: Props) {
    const thinking = thinkingExtra(props.model);
    const web = webExtra(props.model);
    const chosen = cleanOptions(props.model, props.options);
    return (
        <View>
            <View style={styles.deck} accessibilityLabel={t('chat.composer.label')}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeRow} accessibilityRole="tablist">
                    {TYPES.map((item) => {
                        const selected = item.id === 'chat';
                        return (
                            <Pressable
                                key={item.id}
                                accessibilityRole="tab"
                                accessibilityState={{ selected }}
                                style={[styles.type, selected && styles.selected]}
                                onPress={() => item.id !== 'chat' && props.onMake(item.id)}
                            >
                                <Text style={[styles.typeText, selected && styles.selectedText]}>{item.glyph} {t(item.key)}</Text>
                            </Pressable>
                        );
                    })}
                </ScrollView>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.setupRow} accessibilityLabel={t('chat.composer.setup')}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`${t('chat.model.change')}: ${props.model.name}, ${plural('chat.perReply', props.model.credits_per_reply)}`} disabled={props.sending} style={styles.control} onPress={props.onModel}>
                        <Text style={styles.controlText}>▣ {props.model.name}⌄</Text>
                    </Pressable>
                    {thinking !== null ? (
                        <>
                            <Control label={`✦ ${t('chat.opt.standard')}`} selected={!chosen.thinking} disabled={props.sending} onPress={() => props.onOptions({ ...chosen, thinking: false })} />
                            <Control label={`✦ ${t('chat.opt.thinking')} ${plural('chat.opt.extra', thinking)}`} spoken={`${t('chat.opt.thinking')}, ${plural('chat.opt.extraSpoken', thinking)}`} selected={chosen.thinking} disabled={props.sending} onPress={() => props.onOptions({ ...chosen, thinking: true })} />
                        </>
                    ) : null}
                    {web !== null ? (
                        <Control label={`◎ ${t('chat.opt.web')} ${plural('chat.opt.extra', web)}`} spoken={`${t('chat.opt.web')}, ${plural('chat.opt.extraSpoken', web)}`} selected={chosen.web} toggle disabled={props.sending} onPress={() => props.onOptions({ ...chosen, web: !chosen.web })} />
                    ) : null}
                </ScrollView>

                {props.imageExtra !== null ? (
                    <AttachStrip items={props.images} extra={props.imageExtra} max={props.maxImages} disabled={props.sending} embedded onLibrary={props.onLibrary} onPhotos={props.onPhotos} onRemove={props.onRemoveImage} />
                ) : null}

                <View style={styles.inputRow}>
                    <TextInput
                        style={styles.input}
                        value={props.draft}
                        onChangeText={props.onDraft}
                        placeholder={props.placeholder}
                        accessibilityLabel={t('chat.composer.message')}
                        placeholderTextColor={colors.muted}
                        multiline
                        maxLength={8000}
                    />
                    {props.sending ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={props.stopping ? t('chat.stopping') : t('chat.stopLabel')} disabled={props.stopping} style={[styles.send, styles.stop, props.stopping && styles.off]} onPress={props.onStop}>
                            <Text style={styles.stopText}>{props.stopping ? '…' : t('chat.stop')}</Text>
                        </Pressable>
                    ) : (
                        <Pressable accessibilityRole="button" accessibilityLabel={plural('chat.sendPrice', props.price)} disabled={!props.canSend} style={[styles.send, !props.canSend && styles.off]} onPress={props.onSend}>
                            <Text style={styles.sendText}>{t('chat.send')} · {plural('chat.sendPriceShort', props.price)}</Text>
                        </Pressable>
                    )}
                </View>
            </View>
            <Text style={styles.policy}>
                <Text style={styles.money}>{plural('chat.perReply', props.price)}</Text> {t('chat.composer.policy')}
            </Text>
        </View>
    );
}

function Control({ label, spoken, selected, toggle, disabled, onPress }: { label: string; spoken?: string; selected: boolean; toggle?: boolean; disabled?: boolean; onPress: () => void }) {
    return (
        <Pressable
            accessibilityRole={toggle ? 'switch' : 'radio'}
            accessibilityLabel={spoken ?? label}
            accessibilityState={toggle ? { checked: selected, disabled: !!disabled } : { selected, disabled: !!disabled }}
            disabled={disabled}
            style={[styles.control, selected && styles.selected, disabled && styles.off]}
            onPress={onPress}
        >
            <Text style={[styles.controlText, selected && styles.selectedText]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    deck: { overflow: 'hidden', borderRadius: 28, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    typeRow: { minHeight: 48, gap: 4, alignItems: 'center', paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
    type: { minHeight: MIN_TARGET, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: 'transparent', paddingHorizontal: 12 },
    typeText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
    selected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    selectedText: { color: colors.accent },
    setupRow: { minHeight: 52, gap: 6, alignItems: 'center', paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
    control: { minHeight: MIN_TARGET, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, paddingHorizontal: 12 },
    controlText: { color: colors.text, fontSize: 12, fontWeight: '600' },
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 8, paddingVertical: 7 },
    input: { flex: 1, minHeight: MIN_TARGET, maxHeight: 132, color: colors.text, paddingHorizontal: 8, paddingVertical: 11, fontSize: 16, lineHeight: 22 },
    send: { minHeight: MIN_TARGET, maxWidth: 150, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.accent, paddingHorizontal: 16 },
    sendText: { color: colors.accentInk, fontSize: 13, fontWeight: '700', textAlign: 'center' },
    stop: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    stopText: { color: colors.text, fontWeight: '600', textAlign: 'center' },
    off: { opacity: 0.42 },
    policy: { color: colors.muted, fontSize: 11, lineHeight: 15, paddingHorizontal: 5, paddingTop: 5 },
    money: { color: colors.money, fontWeight: '700' },
});
