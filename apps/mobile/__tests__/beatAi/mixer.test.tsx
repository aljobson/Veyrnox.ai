import { act } from 'react';
import { createRoot } from 'test-renderer';
import * as RN from 'react-native';
import { MixerStrip } from '../../src/components/beats/MixerStrip';
import { t } from '../../src/lib/i18n';
import { doc } from './fixtures';
void [RN.View, RN.Text, RN.Pressable];
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
test('audio tracks hide the kit picker while drum tracks retain it', async () => {
    const root = createRoot(), track = doc().tracks[0];
    const props = { index: 0, canRemove: false, onGain: jest.fn(), onPan: jest.fn(), onMute: jest.fn(), onSolo: jest.fn(), onKit: jest.fn(), onRemove: jest.fn() };
    const kitLabel = t('beat.kit', { track: t('beat.track', { n: 1 }) });
    await act(async () => root.render(<MixerStrip {...props} track={track} />));
    expect(root.container.queryAll(n => n.props.accessibilityLabel === kitLabel).length).toBeGreaterThan(0);
    await act(async () => root.render(<MixerStrip {...props} track={{ ...track, kind: 'audio' }} />));
    expect(root.container.queryAll(n => n.props.accessibilityLabel === kitLabel)).toHaveLength(0);
    await act(async () => root.unmount());
}, 30000);
