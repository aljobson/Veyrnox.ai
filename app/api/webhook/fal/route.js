import { createFalWebhookHandler } from '../../../../lib/falWebhookHandler.js';

// Public callbacks always use the real fal verifier and configured storage/database adapters.
export const POST = createFalWebhookHandler();
