import { createSmartCutLiveActivity, smartCutLiveActivityProps } from '../src/lib/smartCutLiveActivity';

test('Live Activity content is generic, bounded and never exposes source details', () => {
    const value = smartCutLiveActivityProps('transcribing', 1, 3);
    expect(value).toMatchObject({ current: 2, total: 3, complete: false });
    expect(value.progress).toBeGreaterThan(0);
    expect(value.progress).toBeLessThan(1);
    expect(JSON.stringify(value)).not.toMatch(/filename|transcript|job[_ -]?id|account/i);
});

test('one activity is started, recovered, updated and ended without notification permission', async () => {
    const instance = { update: jest.fn().mockResolvedValue(undefined), end: jest.fn().mockResolvedValue(undefined) };
    const factory = { getInstances: jest.fn().mockReturnValueOnce([]).mockReturnValue([instance]), start: jest.fn().mockReturnValue(instance) };
    const activity = createSmartCutLiveActivity(true, factory);
    await activity.update('queued', 0, 2);
    expect(factory.start).toHaveBeenCalledTimes(1);
    await activity.update('transcribing', 1, 2);
    expect(instance.update).toHaveBeenCalledTimes(1);
    await activity.complete();
    expect(instance.end).toHaveBeenCalledWith('default', expect.objectContaining({ complete: true, progress: 1 }), expect.any(Date));
});

test('disabled Live Activities never touch ActivityKit', async () => {
    const factory = { getInstances: jest.fn(), start: jest.fn() };
    const activity = createSmartCutLiveActivity(false, factory as never);
    await activity.update('queued', 0, 1);
    expect(factory.getInstances).not.toHaveBeenCalled();
    expect(factory.start).not.toHaveBeenCalled();
});
