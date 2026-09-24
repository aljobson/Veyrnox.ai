const DAY = 86_400_000;

export function assetRetention(row, now = Date.now()) {
  if (row.state !== 'succeeded') return null;
  if (row.has_asset === false) return { text: 'File unavailable. Generation history is kept.', urgent: false };
  const deadline = Date.parse(row.asset_expires_at);
  // Unknown is not a promise of permanent storage, or a guessed job date + 90d.
  if (!Number.isFinite(deadline)) return { text: 'Generated files are kept for 90 days. Save a copy to keep it.', urgent: false };
  const date = new Date(deadline).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  if (deadline <= now) return { text: `Retention ended ${date}. The file may no longer be available.`, urgent: true };
  return { text: `File expires ${date}. Save a copy before then.`, urgent: deadline - now <= 7 * DAY };
}
