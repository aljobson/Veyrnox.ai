import { ApiError, type ApiClient } from '../api';
import type { PublicSession } from './publicSession';
import { isBlockList, isBlockReceipt } from './validateBlocks';
import { publicUuid } from './validatePublic';
const BASE = '/api/v1/music/blocks';
export function blocksOff(error: unknown) { return error instanceof ApiError && error.status === 404 && error.code === 'blocks_unavailable'; }
export async function getBlocks(api: ApiClient, session: PublicSession) {
    const { revision, account } = session.snapshot();
    try {
        const v = await api.request<unknown>(BASE);
        if (revision !== session.snapshot().revision) throw new ApiError(409, 'stale_read');
        if (!isBlockList(v)) throw new ApiError(200, 'bad_response');
        session.replace(v.blocks); session.available(); return v.blocks;
    } catch (e) { if (account === session.snapshot().account && blocksOff(e)) session.unavailable(); throw e; }
}
export async function changeBlock(api: ApiClient, session: PublicSession, actorId: string, blocked: boolean, name = '') {
    if (!publicUuid(actorId)) throw new ApiError(400, 'invalid_actor_id');
    const account = session.snapshot().account;
    try {
        const v = await api.request<unknown>(blocked ? BASE : `${BASE}/${encodeURIComponent(actorId)}`, blocked
            ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actor_id: actorId }) } : { method: 'DELETE' });
        if (account !== session.snapshot().account) throw new ApiError(401, 'account_changed');
        if (!isBlockReceipt(v, actorId, blocked)) throw new ApiError(200, 'bad_response');
        session.acknowledge(actorId, blocked, name);
        // A failed refresh cannot undo the acknowledged block or turn it into an unknown write.
        void getBlocks(api, session).catch(() => {});
        return v;
    } catch (e) { if (account === session.snapshot().account && blocksOff(e)) session.unavailable(); throw e; }
}
