import { editorServerRenderWebhook } from '../../../../lib/editorServerRenderWebhook.js';
import { editorServerRenderDeps } from '../../../../lib/editorServerRenderRuntime.js';
import { withDeliveryLog } from '../../../../lib/webhookDelivery.js';
// Paid work must settle even if admission is switched off.
export const POST = withDeliveryLog('editor-render', request => editorServerRenderWebhook(editorServerRenderDeps())(request));
