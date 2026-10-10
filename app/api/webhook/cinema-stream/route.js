import { streamWebhook } from '../../../../lib/cinema/streamWebhook.js';
import { withDeliveryLog } from '../../../../lib/webhookDelivery.js';
export const dynamic='force-dynamic';
export const POST=withDeliveryLog('cinema-stream', streamWebhook());
