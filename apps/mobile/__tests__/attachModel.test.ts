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
