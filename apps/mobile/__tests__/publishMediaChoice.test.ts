import { choose, clearUpload, type MediaChoice } from '../src/lib/publishMediaChoice';
import type { Job } from '../src/lib/media';
const job: MediaChoice = { kind: 'job', job: { job_id: 'j' } as Job, mediaType: 'image', name: 'Creation' };
const upload: MediaChoice = { kind: 'upload', uploadId: 'u', mediaType: 'video' };
test.each([null, job, upload])('choosing a source replaces the previous one', current => {
    expect(choose(current, job)).toBe(job); expect(choose(current, upload)).toBe(upload);
});
test.each([[null, 'u', null], [job, 'u', job], [upload, 'other', upload], [upload, 'u', null]] as const)('clear only the matching upload', (current, id, expected) => expect(clearUpload(current, id)).toBe(expected));
