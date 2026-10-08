import { finishExtendedConnect } from '../../../../../../../lib/social/extendedConnect.js';

export const POST = (req) => finishExtendedConnect(req, 'threads');
