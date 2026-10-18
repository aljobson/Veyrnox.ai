import { extensionFor, fileNameFor } from '../src/lib/output';

describe('output files', () => {
    test('picks the extension from the media type, defaulting to bin', () => {
        expect(extensionFor('image/png')).toBe('png');
        expect(extensionFor('image/jpeg')).toBe('jpg');
        expect(extensionFor('image/webp')).toBe('webp');
        expect(extensionFor('video/mp4')).toBe('mp4');
        expect(extensionFor('audio/mpeg')).toBe('mp3');
        expect(extensionFor('audio/wav')).toBe('wav');
        expect(extensionFor('application/x-weird')).toBe('bin');
    });

    test('names the file from the job id and never from the link', () => {
        expect(fileNameFor('8f1c2d3e-aaaa-bbbb-cccc-123456789abc', 'video/mp4')).toBe('veyrnox-8f1c2d3e.mp4');
        expect(fileNameFor('../../etc/passwd', 'image/png')).toBe('veyrnox-job.png');
    });
});
