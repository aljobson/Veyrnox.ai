import { useState } from 'react';
import { View } from 'react-native';

import { FRAME_RATIOS, takesFrame } from '../../lib/aspectFrame';
import { t } from '../../lib/i18n';
import { rawText } from '../../lib/i18n/translate';
import { ds } from '../../theme';
import { Chip } from '../ui';

/**
 * The frame choice for image-to-video models that take no ratio of their own: '' keeps the photo as it is, a ratio
 * crops it to that shape before upload. `node` is the chip row (null for other models); the choice follows the model.
 */
export function useFrameChoice(modelId: string | undefined): { readonly value: string; readonly set: (value: string) => void; readonly node: React.ReactNode } {
    const [state, setState] = useState({ value: '' });
    const set = (value: string) => setState({ value });
    if (!takesFrame(modelId)) return { value: '', set, node: null };
    const value = state.value;
    const options = ['', ...FRAME_RATIOS];
    const node = (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm }}>
            {options.map((option) => {
                const label = option === '' ? t('create.frameOriginal') : option;
                return <Chip key={option || 'original'} label={label} accessibilityLabel={rawText(label)} selected={value === option} onPress={() => setState({ value: option })} />;
            })}
        </View>
    );
    return { value, set, node };
}
