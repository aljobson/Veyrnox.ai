import { getStoredUserId } from '../../../lib/authClient';
import { gatewayFetch } from '../../_lib/gateway';

/** Count a signed-in play once per page view (0524). Anonymous plays are not counted. */
export function countMusicPlay(slug, counted) {
  if (counted.current || !getStoredUserId()) return;
  counted.current = true;
  gatewayFetch('/music/plays', { method: 'POST', body: JSON.stringify({ slug }), promptOnAuth: false }).catch(() => {});
}
