import { editorLayoutBudget, TIMELINE_HEADING, TIMELINE_MIN, TRACK_ROW } from '../src/lib/editorLayoutBudget';

const devices = [
    { name: 'iPhone 17 Pro', windowHeight: 874, topInset: 62, bottomInset: 34 },
    { name: 'iPhone SE', windowHeight: 667, topInset: 20, bottomInset: 0 },
];
const regionsBelowChrome = (d: typeof devices[number], trackCount: number) => {
    const b = editorLayoutBudget({ ...d, trackCount });
    const previewArea = 15 + (b.showPreviewHeading ? 26 : 0) + b.previewHeight + 49;
    const chrome = 44 + d.topInset + d.bottomInset + 58 + 51 + 44;
    return { b, panel: d.windowHeight - chrome - previewArea - b.timelineMax };
};

describe('full editor vertical budget', () => {
    for (const d of devices) for (const tracks of [1, 3, 4, 6]) {
        it(`${d.name} with ${tracks} tracks keeps a usable tool panel and a visible timeline`, () => {
            const { b, panel } = regionsBelowChrome(d, tracks);
            expect(panel).toBeGreaterThanOrEqual(200);
            expect(panel).toBeGreaterThanOrEqual(b.panelMin);
            expect(b.timelineMax).toBeGreaterThanOrEqual(TIMELINE_MIN);
            expect(b.timelineScrollMax).toBe(b.timelineMax - TIMELINE_HEADING);
        });
    }
    it('adding tracks never grows the timeline past its bound', () => {
        const three = editorLayoutBudget({ ...devices[0], trackCount: 3 }), nine = editorLayoutBudget({ ...devices[0], trackCount: 9 });
        expect(nine.timelineMax).toBe(three.timelineMax);
    });
    it('a short timeline is not padded beyond its content', () => {
        expect(editorLayoutBudget({ ...devices[0], trackCount: 1 }).timelineMax).toBe(TIMELINE_MIN);
        expect(TRACK_ROW).toBe(56);
    });
    it('short phones use the compact preview', () => {
        expect(editorLayoutBudget({ ...devices[1], trackCount: 3 })).toMatchObject({ compact: true, showPreviewHeading: false, previewHeight: 56 });
        expect(editorLayoutBudget({ ...devices[0], trackCount: 3 })).toMatchObject({ compact: false, showPreviewHeading: true });
    });
});
