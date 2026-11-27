import { File } from 'expo-file-system';

export type PickedFileReadiness = 'ready' | 'unavailable' | 'cancelled';

type ReadableFile = {
    readonly exists: boolean;
    readonly size: number;
    open(): { readBytes(count: number): Promise<Uint8Array>; close(): void };
};

export type PickedFileReadinessOptions = {
    readonly live?: () => boolean;
    readonly timeoutMs?: number;
    readonly pollMs?: number;
    readonly now?: () => number;
    readonly sleep?: (milliseconds: number) => Promise<void>;
    readonly file?: (uri: string) => ReadableFile;
};

const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

/**
 * Files providers may return a cache URI while iCloud is still materialising it. Wait for a
 * non-empty file that can actually be read; `exists` alone is not evidence that the provider
 * finished. The caller owns cancellation so an old project/account can never adopt a late file.
 */
export async function waitForEditorPickedFile(uri: string, options: PickedFileReadinessOptions = {}): Promise<PickedFileReadiness> {
    const live = options.live ?? (() => true);
    const timeoutMs = Math.max(0, options.timeoutMs ?? 30_000);
    const pollMs = Math.max(1, options.pollMs ?? 500);
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? delay;
    const file = options.file ?? (value => new File(value));
    const started = now();

    while (live()) {
        let handle: ReturnType<ReadableFile['open']> | null = null;
        try {
            const candidate = file(uri);
            if (candidate.exists && Number.isSafeInteger(candidate.size) && candidate.size > 0) {
                handle = candidate.open();
                const bytes = await handle.readBytes(1);
                if (!live()) return 'cancelled';
                if (bytes.byteLength === 1) return 'ready';
            }
        } catch { /* iCloud/provider placeholders can be temporarily unreadable. Poll below. */ }
        finally { try { handle?.close(); } catch { /* Readiness result is already determined. */ } }

        const remaining = timeoutMs - (now() - started);
        if (remaining <= 0) return 'unavailable';
        await sleep(Math.min(pollMs, remaining));
    }
    return 'cancelled';
}
