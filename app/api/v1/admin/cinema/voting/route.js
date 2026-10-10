import { votingHandler } from '../../../../../../lib/cinema/votingApi.js';
export const dynamic = 'force-dynamic';
export const GET = votingHandler({ action: 'queue' });
export const POST = votingHandler({ action: 'manage' });
