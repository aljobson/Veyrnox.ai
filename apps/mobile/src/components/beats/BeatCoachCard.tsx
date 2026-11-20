import { useEffect, useRef, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, View } from 'react-native';
import { Button, Text } from '../ui';
import { t } from '../../lib/i18n';
import type { TipId } from '../../lib/beatNative/labs';
export function BeatCoachCard({ id, last, onNext, onSkip }: { id: TipId; last: boolean; onNext(): void; onSkip(): void }) {
    const card = useRef<ComponentRef<typeof View>>(null);
    const text = t(`beatLabs.tip.${id}`);
    useEffect(() => {
        const node = findNodeHandle(card.current);
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
        AccessibilityInfo.announceForAccessibility(text);
    }, [id, text]);
    return <View>
        <View ref={card} accessible accessibilityRole="text" accessibilityLabel={text} accessibilityLiveRegion="polite"><Text>{text}</Text></View>
        <Button label={t(last ? 'beatLabs.done' : 'beatLabs.next')} onPress={onNext} />
        <Button label={t('beatLabs.skip')} onPress={onSkip} />
    </View>;
}
