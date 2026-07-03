/**
 * Stuck-Job Sweeper — Cron Handler
 * 
 * Scheduled: Every 2 minutes (wrangler.jsonc: "*/2 * * * *")
 * 
 * Purpose: Find jobs stuck in PRICED/SUBMITTED/POLLING/STORE_PENDING
 * past their deadline and mark as FAILED → auto-REFUNDED.
 * 
 * Deadlines (in architecture §25.7):
 * - PRICED: 30s (submission delay)
 * - SUBMITTED: 5m (provider processing)
 * - POLLING: 30m (generation time + buffer)
 * - STORE_PENDING: 5m (R2 copy)
 */

import { JobStateMachine } from '../../packages/db/job-state';

export async function handleSweeper(env: any): Promise<void> {
  const sm = new JobStateMachine(env.LEDGER);

  try {
    // Find stuck jobs
    const stuck = await sm.findStuckJobs();
    console.log(`Sweeper: found ${stuck.length} stuck job(s)`);

    if (stuck.length === 0) return;

    // Mark each as FAILED + refund
    for (const job of stuck) {
      try {
        await sm.markFailedAndRefund(
          job.id,
          job.user_id,
          job.credits,
          'timeout'
        );
        console.log(`Refunded job ${job.id} (was in ${job.state} for ${calculateAge(job.updated_at)})`);
      } catch (error) {
        console.error(`Failed to refund job ${job.id}:`, error);
        // Continue to next job; don't halt on single failure
      }
    }
  } catch (error) {
    console.error('Sweeper error:', error);
    throw error;
  }
}

function calculateAge(timestamp: string): string {
  const now = Date.now();
  const age = now - new Date(timestamp).getTime();
  const seconds = Math.floor(age / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}
