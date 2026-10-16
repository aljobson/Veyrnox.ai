'use client';

import { gatewayFetch } from '../veyrnox/_lib/gateway.js';
import { encodeActivityCursor } from '../../lib/social/activityCursor.js';

export const listSocialActivity = (limit = 50, cursor = null) => gatewayFetch(`/social/activity?limit=${encodeURIComponent(limit)}${cursor ? `&cursor=${encodeActivityCursor(cursor)}` : ''}`);
