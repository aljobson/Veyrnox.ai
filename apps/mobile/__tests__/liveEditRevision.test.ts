import { DEFAULT_STACK, history } from '../src/lib/liveEdit/engine';
import { createInferenceLifecycle } from '../src/lib/liveEdit/lifecycle';
import { allowsVisionNavigation } from '../src/lib/liveEdit/navigation';
test('a 200-step slider drag creates one undo entry and restores the pre-drag stack', () => {
    const h = history(); h.begin();
    for (let i = 1; i <= 200; i++) h.set({ ...h.value, smoothing: i / 200 });
    expect(h.value.smoothing).toBe(1); expect(h.canUndo).toBe(false);
    h.commit(); expect(h.canUndo).toBe(true); h.undo();
    expect(h.value).toEqual(DEFAULT_STACK); expect(h.canUndo).toBe(false);
    h.redo(); expect(h.value.smoothing).toBe(1);
});
test('inactive permission overlays preserve the exact export lease; background requires fresh inference', () => {
    const lifecycle = createInferenceLifecycle(), initial = lifecycle.reset();
    expect(lifecycle.accept(initial)).toBe(true); expect(lifecycle.canSave).toBe(true);
    expect(lifecycle.transition('inactive')).toBeNull(); expect(lifecycle.owns(initial)).toBe(true);
    expect(lifecycle.transition('active')).toBeNull(); expect(lifecycle.owns(initial)).toBe(true);
    expect(lifecycle.transition('background')).toBe('suspend'); expect(lifecycle.canSave).toBe(false);
    expect(lifecycle.owns(initial)).toBe(false); expect(lifecycle.accept(initial)).toBe(false);
    expect(lifecycle.transition('active')).toBe('refresh'); expect(lifecycle.canSave).toBe(false);
    expect(lifecycle.accept(lifecycle.generation)).toBe(true); expect(lifecycle.canSave).toBe(true);
    lifecycle.reset(); expect(lifecycle.canSave).toBe(false);
});
test('vision navigation normalizes local URLs but blocks other documents and remote origins', () => {
    const asset = 'file:///cache/My%20Asset.html?version=1#start';
    for (const url of ['about:blank', 'file:///cache/My Asset.html', 'file:///cache/My%20Asset.html?version=2']) expect(allowsVisionNavigation(url, asset)).toBe(true);
    for (const url of ['https://example.com/cache/My%20Asset.html', 'file:///cache/other.html', 'file://other/cache/My%20Asset.html', 'data:text/html,hello', 'about:blank#other', 'file:///cache/My%20Asset.html?version=2#end', 'file:///cache/My%20Asset.html#live', 'file:///cache/%zz']) expect(allowsVisionNavigation(url, asset)).toBe(false);
    expect(allowsVisionNavigation('file:///cache/a', 'not a URL')).toBe(false);
});
