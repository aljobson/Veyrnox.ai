'use client';

import { gatewayFetch } from '../veyrnox/_lib/gateway.js';

export const listSocialActivity = (limit = 50, cursor = null) => gatewayFetch(`/social/activity?limit=${encodeURIComponent(limit)}${cursor ? `&cursor=${encodeURIComponent(JSON.stringify(cursor))}` : ''}`);
