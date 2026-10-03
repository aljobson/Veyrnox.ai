'use client';

import { createContext, useContext } from 'react';

// Whether Veyrnox Publish is open on this deployment. The server layout reads
// PUBLISH_ENABLED and passes it down; outside the provider it reads false.
const PublishFlag = createContext(false);

export function PublishFlagProvider({ enabled, children }) {
  return <PublishFlag.Provider value={enabled === true}>{children}</PublishFlag.Provider>;
}

export function usePublishEnabled() {
  return useContext(PublishFlag);
}
