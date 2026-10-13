import { publishPlanHandler } from '../../../../../lib/social/publishPlanApi.js';
export const dynamic = 'force-dynamic';
export const GET = publishPlanHandler({ action: 'read' });
export const POST = publishPlanHandler({ action: 'start' });
