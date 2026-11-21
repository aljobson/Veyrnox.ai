import { memo, useCallback, useState } from 'react';
import { View } from 'react-native';
import { CURVE_CHANNELS } from '../../../../../../app/veyrnox/_lib/editorColour.mjs';
import { t } from '../../../lib/i18n';
import { ds } from '../../../theme';
import type { Colour } from '../../../lib/editorLookEdit';
import type { LookActions } from './useLookActions';
import { LookChoice } from './LookPanels';
import { CurveEditor } from './CurveEditor';
export const CurvesSection = memo(function CurvesSection({ colour, actions, disabled }: { colour: Colour; actions: LookActions; disabled: boolean }) {
    const [channel, setChannel] = useState(CURVE_CHANNELS[0]);
    const changeCurve = actions.curve;
    const onChange = useCallback((points: Parameters<LookActions['curve']>[1]) => changeCurve(channel, points), [changeCurve, channel]);
    return <View style={{ gap: ds.space.md }}>
        <LookChoice label={t('editorLook.curves')} value={channel} onChange={setChannel}
            options={CURVE_CHANNELS.map(id => ({ value: id, label: t(`editorLook.channel.${id}`) }))} />
        <CurveEditor key={channel} points={colour.curves[channel]} channelLabel={t(`editorLook.channel.${channel}`)}
            disabled={disabled} onChange={onChange} />
    </View>;
});
