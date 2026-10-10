import { createFalWebhookHandler } from '../../../../lib/falWebhookHandler.js';
import { withDeliveryLog } from '../../../../lib/webhookDelivery.js';

// Public callbacks always use the real fal verifier and configured storage/database adapters.
// Every delivery and its answer is logged for /app/admin/webhooks (ADR-0083).
export const POST = withDeliveryLog('fal', createFalWebhookHandler());
