import type { BeatFiles } from '../beatNative/persist';
import { receiptFiles } from './files';
import { MAGIC_LAYER_LIMIT, readLayers, writeLayers } from './shared';
import { namespace, serial } from './storage';
import type { Layer } from './types';
export function magicLayers(files: BeatFiles = receiptFiles()) {
    async function read(owner: string, beatId: string) {
        const name = namespace(owner, beatId, 'layers');
        const raw = await files.read(`${name}.pending`) ?? await files.read(name);
        return readLayers(beatId, { getItem: () => raw, setItem: () => { throw new Error('read_only'); } });
    }
    function change(owner: string, beatId: string, edit: (rows: Layer[]) => Layer[], current = () => true) {
        return serial(namespace(owner, beatId, 'layers'), async () => {
            const rows = edit(await read(owner, beatId));
            if (!current()) return;
            if (rows.length > MAGIC_LAYER_LIMIT) throw new Error('layer_limit');
            let raw = '';
            if (!writeLayers(beatId, rows, { getItem: () => null, setItem: (_, value) => { raw = value; } }) || JSON.stringify(readLayers(beatId, { getItem: () => raw, setItem: () => {} })) !== JSON.stringify(rows)) throw new Error('invalid_layers');
            await files.write(namespace(owner, beatId, 'layers'), raw);
        });
    }
    return { read, change };
}
