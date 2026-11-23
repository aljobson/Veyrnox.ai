import { beatEditorLayout } from '../src/lib/beatNative/editorLayout';

describe('beat editor workspace layout', () => {
    test.each([
        [390, 844, 1, 1, 'compact'],
        [430, 932, 1, 1.25, 'compact'],
        [1024, 768, 1, 1, 'regular'],
        [844, 390, 1, 1, 'compact'],
        [1024, 768, 3.12, 1, 'accessible'],
        [320, 568, 1, 1, 'accessible'],
        [390, 844, 1.35, 1, 'compact'],
        [1024, 768, 1.35, 1, 'regular'],
        [390, 844, 1.36, 1, 'accessible'],
        [1024, 768, 1.36, 1, 'accessible'],
        [768, 1024, 1.3, 1.25, 'accessible'],
    ] as const)('%ipx%ipx, system %s, app %s uses %s', (width, height, fontScale, appScale, expected) => {
        expect(beatEditorLayout(width, height, fontScale, appScale)).toBe(expected);
    });

    test('legacy callers retain their old width and text behavior during route migration', () => {
        expect(beatEditorLayout(1024, 1, 1)).toBe('regular');
    });
});
