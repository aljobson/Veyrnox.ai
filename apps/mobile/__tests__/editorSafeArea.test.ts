import {
    SAFE_AREA_GUIDES,
    contentGuideFor,
    safeAreaPercentStyle,
} from '../src/lib/editorSafeArea';

test('mobile safe-area preview shares the original portrait guide geometry', () => {
    expect(SAFE_AREA_GUIDES.map(guide => guide.id)).toEqual(['off', 'short-form']);
    expect(contentGuideFor({ width: 9, height: 16 })?.content).toEqual({ top: 0.1, right: 0.2, bottom: 0.2, left: 0.1 });
    expect(safeAreaPercentStyle('short-form', 9, 16)).toEqual({ top: '10%', right: '20%', bottom: '20%', left: '10%' });
});

test('mobile safe-area preview remains off for landscape and disabled guides', () => {
    expect(safeAreaPercentStyle('short-form', 16, 9)).toBeNull();
    expect(safeAreaPercentStyle('off', 9, 16)).toBeNull();
    expect(() => contentGuideFor({ width: -1, height: 16 })).toThrow('positive preview dimensions required');
});
