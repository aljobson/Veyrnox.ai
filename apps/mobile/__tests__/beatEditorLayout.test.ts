import { beatEditorLayout } from '../src/lib/beatNative/editorLayout';

describe('beat editor workspace layout', () => {
    test.each([
        [390, 1, 1, 'compact'],
        [430, 1, 1.25, 'compact'],
        [1024, 1, 1, 'regular'],
        [844, 1, 1, 'regular'],
        [1024, 3.12, 1, 'accessible'],
        [320, 1, 1, 'accessible'],
        [390, 1.35, 1, 'compact'],
        [1024, 1.35, 1, 'regular'],
        [390, 1.36, 1, 'accessible'],
        [1024, 1.36, 1, 'accessible'],
        [768, 1.3, 1.25, 'accessible'],
    ] as const)('%ipx, system %s, app %s uses %s', (width, fontScale, appScale, expected) => {
        expect(beatEditorLayout(width, fontScale, appScale)).toBe(expected);
    });
});
