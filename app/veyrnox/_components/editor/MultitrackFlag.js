'use client';
import { createContext, useContext } from 'react';
const Flag = createContext(false);
export function MultitrackFlagProvider({ enabled, children }) { return <Flag.Provider value={enabled === true}>{children}</Flag.Provider>; }
export const useMultitrackEnabled = () => useContext(Flag);
