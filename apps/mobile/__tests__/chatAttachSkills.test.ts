import { attachmentRefs, libraryImageJobs, MAX_IMAGE_EDGE, roomFor, scaledSize } from '../src/lib/chatAttach';
import { NO_OPTIONS, replyPrice, sendKeyFor, type ChatModel } from '../src/lib/chat';
import type { CatalogModel, Job } from '../src/lib/media';
import { MAX_INSTRUCTIONS, parseStudioDrafts, skillById, skillInstructions, SKILLS, withoutDrafts } from '../src/lib/studioSkills';

const model = (images: number | null): ChatModel => ({ id: 'm', name: 'M', maker_label: 'X', credits_per_reply: 2, gated: false, options: { images: images ? { extra_credits: images } : null } });
const cat = (id: string, modality: string, credits: number, extra: Partial<CatalogModel> = {}): CatalogModel => ({
    id, name: id.toUpperCase(), modality, credits, gated: false, durations: [], capabilities: { inputs: { prompt: {} } }, ...extra,
});
const catalog = [cat('img-a', 'text-to-image', 3), cat('vid-b', 'image-to-video', 20, { capabilities: { inputs: { prompt: {} }, media: { image: { required: true } } } }), cat('locked', 'text-to-image', 1, { gated: true }), cat('edit-only', 'image-edit', 4, { capabilities: { inputs: {} } })];

describe('attachments', () => {
    test('images add the model extra once, however many are attached', () => {
        expect(replyPrice(model(1), NO_OPTIONS, 0)).toBe(2);
        expect(replyPrice(model(1), NO_OPTIONS, 1)).toBe(3);
        expect(replyPrice(model(1), NO_OPTIONS, 4)).toBe(3);
        expect(replyPrice(model(null), NO_OPTIONS, 4)).toBe(2);
    });
    test('room is capped at four and never negative', () => {
        expect(roomFor(0)).toBe(4);
        expect(roomFor(3)).toBe(1);
        expect(roomFor(9)).toBe(0);
    });
    test('the long edge is held to the cap and never scaled up', () => {
        expect(scaledSize(4032, 3024)).toEqual({ width: MAX_IMAGE_EDGE, height: 1536 });
        expect(scaledSize(1000, 800)).toEqual({ width: 1000, height: 800 });
        expect(scaledSize(0, 0)).toEqual({ width: 1, height: 1 });
    });
    test('refs are upload keys and Library job ids in the shapes the server takes', () => {
        expect(attachmentRefs(['k1'], ['ABC-1'])).toEqual([{ source_key: 'k1' }, { source_asset: 'abc-1' }]);
    });
    test('the Library offers only finished images', () => {
        const job = (job_id: string, model_id: string, state: Job['state'], has_asset = true): Job => ({ job_id, model_id, state, has_asset, credits: 1, created_at: '' });
        const jobs = [job('1', 'img-a', 'succeeded'), job('2', 'vid-b', 'succeeded'), job('3', 'img-a', 'failed'), job('4', 'img-a', 'succeeded', false)];
        expect(libraryImageJobs(jobs, catalog).map((j) => j.job_id)).toEqual(['1']);
    });
    test('different attachments are a different send and get a new key', () => {
        let n = 0;
        const make = () => `vx-${++n}`;
        const a = sendKeyFor(null, 'hi', NO_OPTIONS, make, 'a-1');
        expect(sendKeyFor(a, 'hi', NO_OPTIONS, make, 'a-1').key).toBe(a.key);
        expect(sendKeyFor(a, 'hi', NO_OPTIONS, make, 'a-1,a-2').key).not.toBe(a.key);
    });
});

describe('studio skills', () => {
    test('the eight Studio skills are present', () => {
        expect(SKILLS.filter((s) => s.group !== 'Film').map((s) => s.id).sort()).toEqual(['add-sound', 'bring-to-life', 'edit-with-words', 'fix-my-photo', 'fix-my-prompt', 'model-picker', 'prompt-writer', 'storyboard']);
    });
    test('the seven Film skills are present, in stage order, each fitting a chat with the live model list', () => {
        const film = SKILLS.filter((s) => s.group === 'Film');
        expect(film.map((s) => s.id)).toEqual(['film-setup', 'film-studio-init', 'film-breakdown', 'film-reference-board', 'film-asset-passport', 'film-stress-test', 'film-shot-prompt']);
        const many = Array.from({ length: 400 }, (_, i) => cat(`m${i}`, 'text-to-image', i + 1));
        for (const s of film) {
            expect(s.starter.length).toBeGreaterThan(0);
            const text = skillInstructions(s, many);
            expect(text).toContain(s.body);
            expect(text.length).toBeLessThanOrEqual(MAX_INSTRUCTIONS);
        }
    });
    test('instructions carry the live open models, cheapest first, and stay within the limit', () => {
        const text = skillInstructions(skillById('prompt-writer')!, catalog);
        expect(text).toContain('img-a|image|3');
        expect(text).toContain('vid-b|video|20|needs image');
        expect(text).not.toContain('locked');
        expect(text).not.toContain('edit-only');
        expect(text.length).toBeLessThanOrEqual(MAX_INSTRUCTIONS);
        const many = Array.from({ length: 400 }, (_, i) => cat(`m${i}`, 'text-to-image', i + 1));
        expect(skillInstructions(skillById('storyboard')!, many).length).toBeLessThanOrEqual(MAX_INSTRUCTIONS);
    });
    const reply = 'Here you go.\n```studio\n{"model":"img-a","prompt":"A red fox in snow"}\n```\n```studio\n{"model":"locked","prompt":"x"}\n```\n```studio\nnot json\n```';
    test('drafts name only known open models and take their price from the catalog', () => {
        expect(parseStudioDrafts(reply, catalog)).toEqual([{ model: 'img-a', name: 'IMG-A', credits: 3, prompt: 'A red fox in snow', needs: [] }]);
        expect(parseStudioDrafts('no blocks', catalog)).toEqual([]);
    });
    test('the cards replace the raw blocks in the text', () => {
        expect(withoutDrafts(reply)).toBe('Here you go.');
    });
});
