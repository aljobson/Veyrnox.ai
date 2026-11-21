import type { BeatFiles } from '../beatNative/persist';
import { receiptFiles } from './files';
import { namespace, serial } from './storage';
import type { Op } from './types';
export function promptDrafts(files: BeatFiles = receiptFiles()) {
    const name = (owner: string, beat: string, op: Op) => namespace(owner, beat, `draft${op.toLowerCase()}`);
    return {
        async read(owner: string, beat: string, op: Op) {
            const key = name(owner, beat, op);
            const raw = await files.read(`${key}.pending`) ?? await files.read(key);
            if (raw === null) return '';
            const value: unknown = JSON.parse(raw);
            return typeof value === 'string' && value.length <= 400 ? value : '';
        },
        write(owner: string, beat: string, op: Op, text: string, current: () => boolean) {
            return serial(name(owner, beat, op), async () => {
                if (current()) await files.write(name(owner, beat, op), JSON.stringify(text.slice(0, 400)));
            });
        },
    };
}
