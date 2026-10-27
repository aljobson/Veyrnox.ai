const mockSetStringAsync = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: (text: string) => mockSetStringAsync(text) }));
import { copyText } from '../src/lib/clipboard';

describe('copyText', () => {
    beforeEach(() => mockSetStringAsync.mockReset());

    test('copies the text and reports success', async () => {
        mockSetStringAsync.mockResolvedValue(true);
        await expect(copyText('Hello')).resolves.toBe(true);
        expect(mockSetStringAsync).toHaveBeenCalledWith('Hello');
    });

    test('reports failure instead of throwing, so the caller can offer the share sheet', async () => {
        mockSetStringAsync.mockRejectedValue(new Error('no native module'));
        await expect(copyText('Hello')).resolves.toBe(false);
    });

    test('does nothing for empty text', async () => {
        await expect(copyText('')).resolves.toBe(false);
        expect(mockSetStringAsync).not.toHaveBeenCalled();
    });
});
