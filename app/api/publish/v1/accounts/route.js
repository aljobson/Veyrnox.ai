import { authenticateSocialCustomerApiRequest, socialCustomerApiResponse } from '../../../../../lib/social/customerApiAuth.js';
import { networkEnabled, networkMedia } from '../../../../../lib/social/networks.js';
import { rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

export async function GET(req) {
  const authenticated = await authenticateSocialCustomerApiRequest(req, 'accounts:read', 'api/publish/v1/accounts:GET', '/api/publish/v1/accounts');
  if (authenticated.error) return authenticated.error;
  try {
    const result = await rpc('list_social_accounts', { p_auth_id: authenticated.authId, p_brand_id: authenticated.brandId }, authenticated.cfg);
    if (!result?.ok) return socialCustomerApiResponse(authenticated, { error: 'service_unavailable' }, 503, 'service_unavailable');
    return socialCustomerApiResponse(authenticated, { data: (result.accounts || []).map((account) => ({
      id: account.id, network: account.network, external_account_id: account.external_account_id,
      display_name: account.display_name, avatar_url: account.avatar_url, status: account.status,
      connected_at: account.connected_at, token_expires_at: account.token_expires_at,
      publishing_enabled: networkEnabled(account.network), supported_media: networkMedia(account.network),
    })) });
  } catch (error) {
    console.error('[api/publish/v1/accounts:GET] failed:', error instanceof SupabaseError ? error.status : 0);
    return socialCustomerApiResponse(authenticated, { error: 'service_unavailable' }, 503, 'service_unavailable');
  }
}
