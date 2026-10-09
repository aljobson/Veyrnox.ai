import { subscriptionHandler } from '../../../../../lib/subscriptions/api.js';
export const dynamic = 'force-dynamic';
export const GET = subscriptionHandler({ action: 'plans' });
