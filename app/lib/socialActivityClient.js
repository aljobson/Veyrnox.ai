'use client';

import { gatewayFetch } from '../veyrnox/_lib/gateway.js';

export const listSocialActivity = (limit = 50) => gatewayFetch(`/social/activity?limit=${encodeURIComponent(limit)}`);
