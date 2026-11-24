import { claimAudioFocus, isAudioFocusOwner, releaseAudioFocus, resetAudioFocusForTests } from '../src/lib/audioFocus';

beforeEach(resetAudioFocusForTests);

test('claiming audio focus pauses the previous local owner exactly once', () => {
    const first = jest.fn(), second = jest.fn();
    claimAudioFocus('first', first);
    expect(isAudioFocusOwner('first')).toBe(true);
    claimAudioFocus('first', first);
    expect(first).not.toHaveBeenCalled();
    claimAudioFocus('second', second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(isAudioFocusOwner('first')).toBe(false);
    expect(isAudioFocusOwner('second')).toBe(true);
    releaseAudioFocus('second');
    expect(isAudioFocusOwner('second')).toBe(false);
    claimAudioFocus('third', jest.fn());
    expect(second).not.toHaveBeenCalled();
});
