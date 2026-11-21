import { eraseAccountReceipts } from '../beatAi/files';
import { beatStore } from './store';
import { eraseBeatTakes } from './takeShared';

/** Each part is attempted even if another fails: the server account is already gone and sign-out must continue. */
export async function eraseLocalBeats(owner: string): Promise<void> {
    await Promise.allSettled([beatStore.eraseOwner(owner), eraseBeatTakes(owner), (async () => eraseAccountReceipts(owner))()]);
}
