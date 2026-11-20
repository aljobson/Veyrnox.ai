import { musicBlocksHandler } from '../../../../../lib/musicBlocks.js';
export const dynamic = 'force-dynamic';
export const GET = musicBlocksHandler();
export const POST = musicBlocksHandler({ action: 'block' });
