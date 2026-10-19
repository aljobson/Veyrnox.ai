import { figureCall, figureHtml, svgForPicks } from '../src/lib/oddlingsFigure';
import { ODDLINGS } from '../src/lib/oddlings';
import { CATEGORIES, CATEGORY_FOCUS, GROUPS, swatchOf, type Picks } from '../src/lib/oddlingsBuilder';

describe('the preview figure', () => {
    test('every character draws a figure made only of safe shapes', () => {
        for (const o of ODDLINGS) {
            const svg = svgForPicks(o.picks as Picks);
            expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="')).toBe(true);
            expect((svg.match(/<(?:circle|ellipse|path|rect|line|polygon|polyline)\b/g) ?? []).length).toBeGreaterThan(10);
            expect(svg).not.toMatch(/<script|<foreignObject|\son[a-z]+=|javascript:|href=/i);
        }
    });

    test('empty picks still draw the neutral figure, and each focus gives its own view box', () => {
        expect(svgForPicks({})).toContain('viewBox="0 0 120 230"');
        expect(svgForPicks({}, 'face')).not.toContain('viewBox="0 0 120 230"');
    });

    test('every option of every group draws without throwing', () => {
        for (const g of GROUPS) for (const [value] of g.options) expect(() => svgForPicks({ [g.id]: value })).not.toThrow();
    });

    test('text in the creator fields never reaches the page as markup', () => {
        const call = figureCall({ oddling_name: '</script><img src=x onerror=alert(1)>' });
        expect(call.startsWith('window.draw(')).toBe(true);
        expect(call).not.toContain('</script');
        expect(call).not.toContain('<');
    });

    test('the page is offline: no URLs to load', () => {
        expect(figureHtml()).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    });
});

describe('categories', () => {
    test('every group is reachable from a category, and each category has a figure focus', () => {
        const reach = new Set(CATEGORIES.flatMap((c) => c.groupIds));
        for (const g of GROUPS) expect(reach.has(g.id)).toBe(true);
        for (const c of CATEGORIES) expect(typeof CATEGORY_FOCUS[c.id]).toBe('string');
    });

    test('colour options carry a swatch', () => {
        expect(swatchOf('hair_color', 'Pink')).toMatch(/^#[0-9a-f]{6}$/i);
        expect(swatchOf('hair', 'Afro')).toBeNull();
    });
});
