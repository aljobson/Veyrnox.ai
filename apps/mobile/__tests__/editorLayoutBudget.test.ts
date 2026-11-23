import { editorLayoutBudget, TIMELINE_HEADING, TIMELINE_MIN, TRACK_ROW, TRANSPORT_HEIGHT } from '../src/lib/editorLayoutBudget';

const devices = [
    { name: 'iPhone 17 Pro', windowWidth: 402, windowHeight: 874, topInset: 62, bottomInset: 34 },
    { name: 'iPhone SE', windowWidth: 375, windowHeight: 667, topInset: 20, bottomInset: 0 },
];
const regionsBelowChrome = (d: typeof devices[number], trackCount: number) => {
    const b = editorLayoutBudget({ ...d, trackCount });
    const previewArea = 15 + (b.showPreviewHeading ? 26 : 0) + b.previewHeight + TRANSPORT_HEIGHT;
    const chrome = 44 + d.topInset + d.bottomInset + 58 + 51 + 44;
    return { b, panel: d.windowHeight - chrome - previewArea - b.timelineMax };
};

describe('full editor vertical budget', () => {
    for (const d of devices) for (const tracks of [1, 3, 4, 6]) {
        it(`${d.name} with ${tracks} tracks keeps a usable tool panel and a visible timeline`, () => {
            const { b, panel } = regionsBelowChrome(d, tracks);
            expect(panel).toBeGreaterThanOrEqual(d.windowHeight < 760 ? 170 : 200);
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
        expect(editorLayoutBudget({ ...devices[1], trackCount: 3 })).toMatchObject({ compact: true, wideShort: false, showPreviewHeading: false, previewHeight: 56 });
        expect(editorLayoutBudget({ ...devices[0], trackCount: 3 })).toMatchObject({ compact: false, wideShort: false, showPreviewHeading: true });
    });
    it('phone landscape gives preview, timeline and inspector the same vertical pane budget', () => {
        const b = editorLayoutBudget({ windowWidth: 874, windowHeight: 402, fontScale: 1, topInset: 0, bottomInset: 21, trackCount: 6 });
        expect(b).toMatchObject({ compact: true, wideShort: true, showPreviewHeading: false, panelMin: 0 });
        expect(b.timelineMax).toBeGreaterThanOrEqual(TIMELINE_MIN);
        expect(b.timelineScrollMax).toBe(b.timelineMax - TIMELINE_HEADING);
        expect(b.previewHeight).toBeGreaterThanOrEqual(56);
    });
    it('accessibility text keeps all three panes visible and yields preview height to growing controls', () => {
        expect(editorLayoutBudget({ windowWidth: 874, windowHeight: 402, fontScale: 1.3, bottomInset: 21, trackCount: 3 }))
            .toMatchObject({ compact: true, wideShort: true, showPreviewHeading: false, previewHeight: 56 });
    });
});
