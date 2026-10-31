import { planAttachments } from '../src/lib/attachModel';
import type { CatalogModel } from '../src/lib/media';
import type { SlotKind } from '../src/lib/sources';

const model = (id: string, modality: string, credits: number, media: Record<string, { required?: boolean }> = {}, gated = false): CatalogModel => ({
    id, name: id, modality, credits, gated, durations: [5], capabilities: { inputs: { prompt: { max: 500 } }, media },
});
const item = (kind: SlotKind, name: string) => ({ kind, name });

const text = model('t', 'text-to-video', 10);
const i2v = model('i2v', 'image-to-video', 20, { image: { required: true } });
const cheapGated = model('g', 'image-to-video', 1, { image: { required: true } }, true);
const frames = model('frames', 'image-to-video', 30, { image: { required: true }, endImage: { required: false } });
const lipsync = model('lip', 'image-to-video', 40, { image: { required: true }, audio: { required: true } });
const edit = model('edit', 'image-to-image', 3, { image: { required: false } });

describe('planAttachments', () => {
    it('one picture goes to the same media kind, open, then cheapest', () => {
        expect(planAttachments([text, edit, cheapGated, i2v, frames], text, [item('image', 'a')])?.model.id).toBe('i2v');
    });
    it('two pictures go to a model with a start and an end frame', () => {
        const plan = planAttachments([text, i2v, frames], text, [item('image', 'a'), item('image', 'b')]);
        expect(plan?.model.id).toBe('frames');
        expect(plan?.assignments.map((a) => [a.slot, a.item.name])).toEqual([['image', 'a'], ['endImage', 'b']]);
    });
    it('a picture and a sound go to a model that takes both', () => {
        expect(planAttachments([text, i2v, lipsync], text, [item('image', 'a'), item('audio', 's')])?.model.id).toBe('lip');
    });
    it('reports files no slot took, and returns null when nothing fits', () => {
        expect(planAttachments([i2v], i2v, [item('image', 'a'), item('image', 'b')])?.unused).toHaveLength(1);
        expect(planAttachments([lipsync], lipsync, [item('image', 'a')])).toBeNull();
    });
});

it('chooses the verified three-file model and preserves assignment order', () => {
    const multi: CatalogModel = { ...edit, id: 'multi', capabilities: { media: { image: { maxFiles: 3, required: true } } } };
    const files = [item('image','a'),item('image','b'),item('image','c'),item('image','d')];
    const plan = planAttachments([frames,multi],frames,files);
    expect(plan?.model.id).toBe('multi');
    expect(plan?.assignments.map(a=>a.item.name)).toEqual(['a','b','c']);
    expect(plan?.unused).toEqual([files[3]]);
});

describe('reference models verified for more than three pictures', () => {
    const reference = (): CatalogModel => ({
        id: 'ref', name: 'ref', modality: 'image-to-video', credits: 85, gated: false, durations: [5],
        capabilities: { inputs: { prompt: { max: 500 } }, media: { image: { required: true, maxFiles: 9 } } },
    } as unknown as CatalogModel);
    it('takes nine pictures in one image slot and reports the tenth unused', () => {
        const items = Array.from({ length: 10 }, (_, i) => item('image', `p${i}`));
        const plan = planAttachments([reference()], reference(), items);
        expect(plan?.assignments).toHaveLength(9);
        expect(plan?.assignments.every((a) => a.slot === 'image')).toBe(true);
        expect(plan?.unused).toHaveLength(1);
    });
    it('frame models keep three pictures a kind at most', () => {
        const plan = planAttachments([frames], frames, Array.from({ length: 5 }, (_, i) => item('image', `p${i}`)));
        expect(plan?.assignments).toHaveLength(2);
    });
});
