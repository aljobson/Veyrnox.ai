export const TRIM_HANDLE_MIN = 44;

/** Width of one trim handle: a finger-sized 44 pt, but on short clips never more than a third of the body, so the middle stays draggable. */
export function trimHandleWidth(bodyWidth: number): number {
    return Math.round(Math.min(TRIM_HANDLE_MIN, bodyWidth / 3) * 100) / 100;
}

/** Items are drawn in array order, so a later item sits on top. The label of an item whose start is covered by a later item would print under it. */
export function hiddenLabelIds(items: readonly { id: string; start: number; len: number }[]): ReadonlySet<string> {
    const hidden = new Set<string>();
    items.forEach((item, index) => {
        if (items.slice(index + 1).some(other => other.start <= item.start && other.start + other.len > item.start)) hidden.add(item.id);
    });
    return hidden;
}
