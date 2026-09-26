import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recentMfaTimestamp } from '../lib/cinema/strongAuth.js';
test('approval freshness requires a recent verified TOTP event, not token refresh time', () => {
  const now=1900000000;
  const claim=(time)=>({ aal:'aal2', iat:now, amr:[{method:'totp',timestamp:time}] });
  assert.equal(recentMfaTimestamp(claim(now-300),now),now-300);
  for (const time of [now-301,now+6,0,'1900000000',Infinity,NaN]) assert.equal(recentMfaTimestamp(claim(time),now),null);
  for (const claims of [{aal:'aal1',amr:[{method:'totp',timestamp:now}]},{aal:'aal2',iat:now},{aal:'aal2',amr:[{method:'token_refresh',timestamp:now}]},{aal:'aal2',amr:[{method:'password',timestamp:now}]}]) assert.equal(recentMfaTimestamp(claims,now),null);
});
test('middleware strips caller freshness headers and derives them from verified claims',()=>{
  const source=readFileSync(new URL('../middleware.js',import.meta.url),'utf8');
  assert.match(source,/'x-veyrnox-auth-mfa-at',/);
  assert.ok(source.indexOf('recentMfaTimestamp(claims)') > source.indexOf('validateClaims(claims'));
  assert.match(source,/headers\.delete\(h\)/);
});
