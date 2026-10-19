import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { thinkingExtra, webExtra, type ChatModel, type ReplyOptions } from '../../lib/chat';
import { plural, t } from '../../lib/i18n';
import { colors } from '../../theme';

interface Props {
    readonly model: ChatModel;
    readonly options: ReplyOptions;
    readonly disabled?: boolean;
    readonly onChange: (next: ReplyOptions) => void;
}

// Standard or Thinking, and Web, each with the credits it adds, before anything is sent (ADR-0154). The row appears
// only for the choices the model offers; a model with none shows nothing.
export function ReplyOptionsBar({ model, options, disabled, onChange }: Props) {
    const thinking = thinkingExtra(model);
    const web = webExtra(model);
    if (thinking === null && web === null) return null;
    return (
        <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('chat.opt.group')}>
            {thinking !== null ? (
                <>
                    <Chip
                        label={t('chat.opt.standard')}
                        selected={!options.thinking}
                        disabled={disabled}
                        onPress={() => onChange({ ...options, thinking: false })}
                    />
                    <Chip
                        label={`${t('chat.opt.thinking')} ${plural('chat.opt.extra', thinking)}`}
                        spoken={`${t('chat.opt.thinking')}, ${plural('chat.opt.extraSpoken', thinking)}`}
                        selected={options.thinking}
                        disabled={disabled}
                        onPress={() => onChange({ ...options, thinking: true })}
                    />
                </>
            ) : null}
            {web !== null ? (
                <Chip
                    label={`${t('chat.opt.web')} ${plural('chat.opt.extra', web)}`}
                    spoken={`${t('chat.opt.web')}, ${plural('chat.opt.extraSpoken', web)}`}
                    selected={options.web}
                    toggle
                    disabled={disabled}
                    onPress={() => onChange({ ...options, web: !options.web })}
                />
            ) : null}
        </View>
    );
}

function Chip({ label, spoken, selected, toggle, disabled, onPress }: { label: string; spoken?: string; selected: boolean; toggle?: boolean; disabled?: boolean; onPress: () => void }) {
    return (
        <Pressable
            accessibilityRole={toggle ? 'switch' : 'radio'}
            accessibilityLabel={spoken ?? label}
            accessibilityState={toggle ? { checked: selected, disabled: !!disabled } : { selected, disabled: !!disabled }}
            disabled={disabled}
            style={[styles.chip, selected && styles.chipOn, disabled && styles.off]}
            onPress={onPress}
        >
            <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 8 },
    chip: { minHeight: MIN_TARGET, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
    chipOn: { borderColor: colors.accent, backgroundColor: colors.surface },
    chipText: { color: colors.muted, fontSize: 14 },
    chipTextOn: { color: colors.accent },
    off: { opacity: 0.4 },
});
