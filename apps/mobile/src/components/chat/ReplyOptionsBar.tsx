import { View } from 'react-native';

import { thinkingExtra, webExtra, type ChatModel, type ReplyOptions } from '../../lib/chat';
import { t } from '../../lib/i18n';
import { themedStyles, useThemedStyles } from '../ui';
import { ReplyOptionChip } from './ReplyOptionChip';

interface Props {
    readonly model: ChatModel;
    readonly options: ReplyOptions;
    readonly disabled?: boolean;
    readonly onChange: (next: ReplyOptions) => void;
}

// Standard or Thinking, and Web, each with the credits it adds, before anything is sent (ADR-0154). The row appears
// only for the choices the model offers; a model with none shows nothing.
export function ReplyOptionsBar({ model, options, disabled, onChange }: Props) {
    const styles = useThemedStyles(sheets);
    const thinking = thinkingExtra(model);
    const web = webExtra(model);
    if (thinking === null && web === null) return null;
    return (
        <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('chat.opt.group')}>
            {thinking !== null ? (
                <>
                    <ReplyOptionChip
                        label={t('chat.opt.standard')}
                        selected={!options.thinking}
                        disabled={disabled}
                        onPress={() => onChange({ ...options, thinking: false })}
                    />
                    <ReplyOptionChip
                        label={t('chat.opt.thinking')} extra={thinking}
                        selected={options.thinking}
                        disabled={disabled}
                        onPress={() => onChange({ ...options, thinking: true })}
                    />
                </>
            ) : null}
            {web !== null ? (
                <ReplyOptionChip
                    label={t('chat.opt.web')} extra={web}
                    selected={options.web}
                    toggle
                    disabled={disabled}
                    onPress={() => onChange({ ...options, web: !options.web })}
                />
            ) : null}
        </View>
    );
}

const sheets = themedStyles(() => ({
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 8 },
}));
