import { localExportDimensions, localExportInterruptedState } from '../src/components/editor/LocalExportSheet';

jest.mock('../src/auth/sessionTask', () => ({ useSessionTask: () => () => ({ current: () => true }) }));

test('uses bounded native export dimensions for every editor canvas', () => {
    expect(localExportDimensions({ aspect_ratio: '16:9', frame_rate: 30 })).toEqual({ width: 1280, height: 720 });
    expect(localExportDimensions({ aspect_ratio: '9:16', frame_rate: 30 })).toEqual({ width: 720, height: 1280 });
    expect(localExportDimensions({ aspect_ratio: '1:1', frame_rate: 30 })).toEqual({ width: 960, height: 960 });
});

test('a stale session exits the exporting state so close and retry are not left disabled', () => {
    expect(localExportInterruptedState(false, false)).toEqual({ phase: 'error', error: 'stale' });
    expect(localExportInterruptedState(true, true)).toEqual({ phase: 'idle', error: null });
});
