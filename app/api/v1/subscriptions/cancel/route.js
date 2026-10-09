import { subscriptionHandler } from '../../../../../lib/subscriptions/api.js';
export const dynamic = 'force-dynamic';
export const POST = subscriptionHandler({ action: 'cancel' });
