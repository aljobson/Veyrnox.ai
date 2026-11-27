import { submitSmartCutFeedback } from '../src/lib/smartCutFeedback';

test('sends only the private Smart Cut feedback contract', async () => {
    const request = jest.fn(async () => ({ accepted: true, replayed: false }));
    await submitSmartCutFeedback({ request } as never, {
        responseId: '8f9e48c8-8698-4be6-a197-8399a2cbd0c9', rating: 'down', comment: '  Too abrupt  ', planMode: 'transcript-silence',
    });
    expect(request).toHaveBeenCalledWith('/api/v1/editor/smart-cut-feedback', expect.objectContaining({
        method: 'POST', body: JSON.stringify({ response_id: '8f9e48c8-8698-4be6-a197-8399a2cbd0c9', rating: 'down', comment: 'Too abrupt', plan_mode: 'transcript-silence' }),
    }));
});
