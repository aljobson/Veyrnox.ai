// The studio's view of a free allowance (ADR-0069). The server decides what is free; this only works out what the
// button should say. Jobs in a batch are submitted in order and each takes one allowance, so the first `left` are
// free and the rest are priced normally.

/** Credits the batch will cost once the free allowance is applied. */
export function freeCost(unitCost, count, left) {
    const free = Math.min(Math.max(0, Number(left) || 0), count);
    return unitCost * Math.max(0, count - free);
}

/** How many of this model's jobs are free today for the signed-in account. */
export function freeLeftFor(map, modelId) {
    const n = map ? map[modelId] : undefined;
    return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0;
}
