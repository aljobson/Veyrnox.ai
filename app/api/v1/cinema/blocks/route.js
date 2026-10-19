import { blocksHandler } from '../../../../../lib/cinema/blocksApi.js';
export const dynamic = 'force-dynamic';
export const GET = blocksHandler();
export const POST = blocksHandler({ action: 'block' });
