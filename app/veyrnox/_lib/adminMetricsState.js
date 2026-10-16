/** Fixed messages only: server error bodies may contain private diagnostics. */
export function adminMetricsState(error) {
  if (error?.status === 401) return 'unauthenticated';
  if (error?.status !== 403) return 'error';
  if (error.code === 'mfa_required') return 'mfa';
  if (error.code === 'access_required') return 'access';
  if (error.code === 'not_admin') return 'forbidden';
  return 'unverified';
}

export const ADMIN_METRICS_COPY = Object.freeze({
  loading: 'Loading…',
  mfa: 'Please verify your authenticator below, then retry operations metrics.',
  access: 'Complete your Cloudflare Access sign-in, then retry operations metrics.',
  forbidden: 'This account is not an administrator.',
  unauthenticated: 'Sign in with an administrator account to view operations metrics.',
  unverified: 'Administrator access could not be verified. Retry after checking your sign-in.',
  error: 'Metrics are unavailable right now.',
});
