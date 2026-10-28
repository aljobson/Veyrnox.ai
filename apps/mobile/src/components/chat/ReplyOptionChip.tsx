import { rawText } from '../../lib/i18n/translate';
import { plural } from '../../lib/i18n';
import { Chip, Text } from '../ui';

// The same priced reply choices appear in the deck and the standalone options row.
export function ReplyOptionChip({ label, extra, selected, toggle, disabled, onPress }: {
    label: string; extra?: number; selected: boolean; toggle?: boolean; disabled?: boolean; onPress: () => void;
}) {
    return (
        <Chip label={label} icon={toggle ? 'globe' : 'brain'}
            selected={selected}
            accessibilityRole={toggle ? 'switch' : 'radio'}
            accessibilityLabel={rawText(extra === undefined ? label : `${label}, ${plural('chat.opt.extraSpoken', extra)}`)}
            accessibilityState={toggle ? { checked: selected, disabled: !!disabled } : { selected, disabled: !!disabled }}
            disabled={disabled} onPress={onPress}>
            <Text variant="caption" tone={selected ? 'accent' : 'secondary'}>{label}</Text>
            {extra !== undefined ? <Text variant="caption" tone="warning">{plural('chat.opt.extra', extra)}</Text> : null}
        </Chip>
    );
}
