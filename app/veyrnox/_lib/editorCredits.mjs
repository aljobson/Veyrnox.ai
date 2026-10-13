export const FREE_EDITOR_BENEFITS = Object.freeze([
  'Full multitrack video editor',
  'Local preview and export',
  'Cloud projects and version history',
  'No card required',
]);

export function editorCreditPack(pack) {
  if (
    typeof pack?.id !== 'string' ||
    !/^web-[a-z0-9-]{1,40}$/.test(pack.id) ||
    !Number.isSafeInteger(pack.credits) ||
    pack.credits <= 0 ||
    !Number.isSafeInteger(pack.price_usd_cents) ||
    pack.price_usd_cents <= 0
  ) {
    return null;
  }
  return {
    id: pack.id,
    credits: pack.credits,
    price_usd_cents: pack.price_usd_cents,
  };
}

export function editorCreditPacks(packs) {
  return Array.isArray(packs)
    ? packs
        .map(editorCreditPack)
        .filter(Boolean)
        .sort((a, b) => a.credits - b.credits)
    : [];
}
