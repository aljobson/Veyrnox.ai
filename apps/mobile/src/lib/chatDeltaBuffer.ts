// Coalesce tokens without delaying completion or dropping the last partial batch.
export function createChatDeltaBuffer(append: (id: string, text: string) => void) {
    let id: string | null = null;
    let closed = false;
    let pending = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
        clearTimeout(timer); timer = undefined;
        const text = pending; pending = '';
        if (id && text && !closed) append(id, text);
    };
    return {
        begin(messageId: string) { flush(); id = messageId; closed = false; },
        add(text: string) {
            if (!id || closed) return;
            pending += text;
            if (timer === undefined) timer = setTimeout(flush, 50);
        },
        flush,
        // Keeps the id until the next begin, so the bubble still shows "writing" while the send finishes.
        close() { flush(); closed = true; },
        get messageId() { return id; },
    };
}
