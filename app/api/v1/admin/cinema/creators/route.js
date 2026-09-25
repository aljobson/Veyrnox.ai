import { creatorHandler } from '../../../../../../lib/cinema/creatorApi.js';
export const GET = creatorHandler({ review: true });
export const POST = creatorHandler({ review: true, create: true });
