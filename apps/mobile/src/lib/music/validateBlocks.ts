import { isRecord } from '../responseShapes';
import { exact, publicDate, publicText, publicUuid } from './validatePublic';
import type { Blocked, BlockReceipt, BlockRow } from './publicTypes';
export function isBlocked(v: unknown): v is Blocked {
    return isRecord(v) && exact(v, ['blocked']) && isRecord(v.blocked) && exact(v.blocked, ['creator_id', 'display_name'])
        && publicUuid(v.blocked.creator_id) && publicText(v.blocked.display_name, 80);
}
export function isBlockList(v: unknown): v is { blocks: BlockRow[] } {
    return isRecord(v) && exact(v, ['blocks']) && Array.isArray(v.blocks) && v.blocks.length <= 500
        && v.blocks.every(b => isRecord(b) && exact(b, ['actor_id', 'display_name', 'created_at'])
            && publicUuid(b.actor_id) && publicText(b.display_name, 80) && publicDate(b.created_at))
        && new Set(v.blocks.map(b => b.actor_id.toLowerCase())).size === v.blocks.length;
}
export function isBlockReceipt(v: unknown, id: string, blocked: boolean): v is BlockReceipt {
    return isRecord(v) && exact(v, ['actor_id', 'blocked', 'already']) && publicUuid(v.actor_id)
        && v.actor_id.toLowerCase() === id.toLowerCase() && v.blocked === blocked && typeof v.already === 'boolean';
}
