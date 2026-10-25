import { Pressable, Text, View } from 'react-native';
import { touchTarget } from '../lib/a11y';
import { t } from '../lib/i18n';
import { choiceId, type MediaChoice } from '../lib/publishMediaChoice';
import { colors } from '../theme';

export function PublishMediaSelection({ items, max, onChange, disabled }: {
    items: MediaChoice[]; max: number; onChange: (items: MediaChoice[]) => void; disabled: boolean;
}) {
    function move(index: number, direction: number) {
        const next = [...items], to = index + direction;
        if (to < 0 || to >= next.length) return;
        [next[index], next[to]] = [next[to], next[index]];
        onChange(next);
    }
    return <View style={{ gap: 8 }}>
        {max > 1 ? <Text style={{ color: colors.text }}>{t('app.publish.carousel.limit', { count: items.length, max })}</Text> : null}
        {items.map((item, index) => <View key={choiceId(item)} style={{ gap: 4 }}>
            <Text style={{ color: colors.text }}>{t('app.publish.carousel.item', { count: index + 1 })} · {item.kind === 'job' ? item.name : t(item.mediaType === 'image' ? 'publishUploads.image' : 'publishUploads.video')}</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
                {(['earlier', 'later', 'remove'] as const).map(action => {
                    const off = disabled || (action === 'earlier' && index === 0) || (action === 'later' && index === items.length - 1);
                    return <Pressable key={action} style={touchTarget} accessibilityRole="button" accessibilityState={{ disabled: off }} disabled={off}
                        onPress={() => action === 'remove' ? onChange(items.filter((_, i) => i !== index)) : move(index, action === 'earlier' ? -1 : 1)}>
                        <Text style={{ color: colors.text }}>{t(action === 'remove' ? 'app.publish.common.remove' : `app.publish.carousel.${action}`)}</Text>
                    </Pressable>;
                })}
            </View>
        </View>)}
    </View>;
}
