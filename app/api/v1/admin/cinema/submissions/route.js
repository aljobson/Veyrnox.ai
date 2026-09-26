import { publishHandler } from '../../../../../../lib/cinema/publishApi.js';
export const dynamic = 'force-dynamic';
export const GET = publishHandler({ action: 'queue' });
export const POST = publishHandler({ action: 'review' });
