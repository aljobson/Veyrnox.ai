import { modelForAttachment } from '../src/lib/attachModel';
import type { CatalogModel } from '../src/lib/media';

const model = (id: string, modality: string, credits: number, media: Record<string, { required?: boolean }> = {}, gated = false): CatalogModel => ({
    id, name: id, modality, credits, gated, durations: [5], capabilities: { inputs: { prompt: { max: 500 } }, media },
});

const text = model('t', 'text-to-video', 10);
const i2v = model('i2v', 'image-to-video', 20, { image: { required: true } });
const cheapGated = model('g', 'image-to-video', 1, { image: { required: true } }, true);
const edit = model('edit', 'image-to-image', 3, { image: { required: false } });
const both = model('both', 'image-to-video', 1, { image: { required: true }, audio: { required: true } });

describe('modelForAttachment', () => {
    it('prefers the same media kind, open, then cheapest', () => {
        expect(modelForAttachment([text, edit, cheapGated, i2v, both], text, 'image')?.id).toBe('i2v');
    });
    it('returns null when nothing takes the kind', () => {
        expect(modelForAttachment([text], text, 'audio')).toBeNull();
    });
});
