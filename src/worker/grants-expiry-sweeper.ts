/**
 * Grants Expiry Sweeper — Cron Handler
 * 
 * Scheduled: Daily at 3 AM UTC (wrangler.jsonc: "0 3 * * *")
 * 
 * Purpose: Find grants past their expires_at and mark them expired.
 * 
 * §25.3 Invariant: Non-rollover expiry is in schema, not a cron afterthought.
 * When a grant expires, append a compensating -delta entry (reason: expire:cycle).
 * User balance automatically reflects only active credits.
 */

import { GrantManager } from '../../packages/db/grants';

export async function handleGrantsExpirySweeper(env: any): Promise<void> {
  const gm = new GrantManager(env.LEDGER);

  try {
    const expiredCount = await gm.expireCredits();
    console.log(`Grants expiry sweeper: marked ${expiredCount} grants as expired`);
  } catch (error) {
    console.error('Grants expiry sweeper error:', error);
    throw error;
  }
}
