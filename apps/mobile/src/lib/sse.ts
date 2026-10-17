export interface SseEvent {
    readonly event: string;
    readonly data: unknown;
}

// Incremental parser for the server's frames: `event: <name>\ndata: <json>\n\n`.
// Feed it text as it arrives; it returns the complete events and keeps the rest.
export function createSseParser() {
    let buffer = '';
    return {
        push(chunk: string): SseEvent[] {
            buffer += chunk.replace(/\r\n/g, '\n');
            const events: SseEvent[] = [];
            let end: number;
            while ((end = buffer.indexOf('\n\n')) !== -1) {
                const frame = buffer.slice(0, end);
                buffer = buffer.slice(end + 2);
                let event = 'message';
                const dataLines: string[] = [];
                for (const line of frame.split('\n')) {
                    if (line.startsWith('event:')) event = line.slice(6).trim();
                    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
                }
                if (dataLines.length === 0) continue;
                try {
                    events.push({ event, data: JSON.parse(dataLines.join('\n')) });
                } catch {
                    // A malformed frame is skipped; the turn's own done/error event still decides the outcome.
                }
            }
            return events;
        },
    };
}
