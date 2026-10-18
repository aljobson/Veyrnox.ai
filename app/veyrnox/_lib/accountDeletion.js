'use client';

/**
 * Account deletion client (ADR-0111): the two calls behind the Account page's
 * "Delete account" section. Step one reports what would be lost and what stops
 * it; step two erases with the single-use token step one returned.
 */

import { gatewayFetch } from './gateway.js';

export const BLOCKER_COPY = {
  account_frozen: 'Your account is paused while we review a payment dispute. Contact support@veyrnox.com to resolve it first.',
  account_on_hold: 'Some of your content is being preserved after a report, so the account cannot be deleted yet. Contact support@veyrnox.com.',
  active_subscription: 'You have an active subscription. Cancel it first (Account & security > Manage billing, or in the App Store or Google Play), then delete.',
  generation_in_progress: 'A generation is still running. Wait for it to finish, then try again.',
  top_up_in_progress: 'A credit purchase is still being processed. Wait a few minutes, then try again.',
  cinema_content_present: 'You have Cinema titles or uploads. Contact support@veyrnox.com to have them withdrawn first.',
  projects_present: 'You own projects. Delete them from the Projects page first.',
  publish_team_present: 'One of your Publish brands has other members. Remove them or contact support@veyrnox.com first.',
};

/** @returns {Promise<{state:'unavailable'}|{state:'blocked',blockers:string[],credits:number}|{state:'ready',token:string,credits:number,expiresAt:string}>} */
export async function prepareDeletion() {
  let res;
  try {
    res = await gatewayFetch('/account/deletion', { method: 'POST' });
  } catch (err) {
    if (err.code === 'not_found') return { state: 'unavailable' };
    throw err;
  }
  const credits = Number(res?.forfeit?.credits) || 0;
  if (res?.eligible === true && typeof res.confirmation_token === 'string') {
    return { state: 'ready', token: res.confirmation_token, credits, expiresAt: res.expires_at };
  }
  return { state: 'blocked', blockers: Array.isArray(res?.blockers) ? res.blockers : [], credits };
}

/** Erase. Throws a GatewayError; `deletion_incomplete` and 5xx are safe to retry with the same token. */
export async function confirmDeletion(token) {
  return gatewayFetch('/account', { method: 'DELETE', body: JSON.stringify({ confirmation_token: token }) });
}
