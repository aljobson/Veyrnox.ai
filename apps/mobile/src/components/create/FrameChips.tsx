import { useState } from 'react';
import { View } from 'react-native';

import { FRAME_RATIOS, takesFrame } from '../../lib/aspectFrame';
import { t } from '../../lib/i18n';
import { rawText } from '../../lib/i18n/translate';
import { ds } from '../../theme';
import { Chip } from '../ui';

// A model switch opens the Create screen again for the new model, which would reset the choice while the photo already
// uploaded is still the cropped one. The frame travels with the hand-off key instead: `carry` files it under the key of
// the route being opened and the new screen starts from it. A key is used once; the oldest are dropped past MAX_CARRIED.
const MAX_CARRIED = 20;
const carried = new Map<string, string>();

type Href = { readonly params?: { readonly sourceHandoff?: unknown } };

/**
 * The frame choice for image-to-video models that take no ratio of their own: '' keeps the photo as it is, a ratio
 * crops it to that shape before upload. `node` is the chip row (null for other models); the choice follows the model.
 * `handoff` is the hand-off key this screen was opened with; `carry` wraps the route a model switch opens.
 */
export function useFrameChoice(modelId: string | undefined, handoff?: string): {
    readonly value: string; readonly node: React.ReactNode; readonly carry: <T extends Href>(href: T) => T;
} {
    const [state, setState] = useState(() => ({ value: (handoff && carried.get(handoff)) || '' }));
    const value = takesFrame(modelId) ? state.value : '';
    const carry = <T extends Href>(href: T): T => {
        const key = href.params?.sourceHandoff;
        if (typeof key === 'string' && value) {
            carried.set(key, value);
            for (const old of [...carried.keys()].slice(0, Math.max(0, carried.size - MAX_CARRIED))) carried.delete(old);
        }
        return href;
    };
    if (!takesFrame(modelId)) return { value: '', node: null, carry };
    const options = ['', ...FRAME_RATIOS];
    const node = (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm }}>
            {options.map((option) => {
                const label = option === '' ? t('create.frameOriginal') : option;
                return <Chip key={option || 'original'} label={label} accessibilityLabel={rawText(label)} selected={value === option} onPress={() => setState({ value: option })} />;
            })}
        </View>
    );
    return { value, node, carry };
}
