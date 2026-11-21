import { useState } from 'react';
import { View } from 'react-native';
import { HSL_CHANNELS } from '../../../../../../app/veyrnox/_lib/editorColour.mjs';
import { t } from '../../../lib/i18n';
import { ds } from '../../../theme';
import type { Colour, HslKey } from '../../../lib/editorLookEdit';
import type { LookActions } from './useLookActions';
import { Slider } from './Slider';
import { LookChoice, degrees, percent } from './LookPanels';
export function HslSection({ colour, actions, disabled }: { colour: Colour; actions: LookActions; disabled: boolean }) {
    const [channel, setChannel] = useState(HSL_CHANNELS[0]);
    return <View style={{ gap: ds.space.md }}>
        <LookChoice label={t('editorLook.hsl')} value={channel} disabled={disabled} onChange={setChannel}
            options={HSL_CHANNELS.map(id => ({ value: id, label: t(`editorLook.channel.${id}`) }))} />
        {(['hue', 'saturation', 'luminance'] as HslKey[]).map(key => <Slider key={key} label={t(`editorLook.parameter.${key}`)}
            value={colour.hsl[channel][key]} min={key === 'hue' ? -180 : -1} max={key === 'hue' ? 180 : 1} step={key === 'hue' ? 1 : .01}
            format={key === 'hue' ? degrees : percent} disabled={disabled} onChange={value => actions.hsl(channel, key, value)} />)}
    </View>;
}
