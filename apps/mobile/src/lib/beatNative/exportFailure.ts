// Kept independent of the audio engine so cache cleanup can load without native audio/storage setup.
export class ExportFailure extends Error {
    constructor(readonly key: string, readonly params?: Record<string, number>) { super(key); }
}
