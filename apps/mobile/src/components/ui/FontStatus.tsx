import { createContext } from 'react';
// Mounted text updates when its requested family finishes loading; unavailable fonts use the system face.
export const FontStatus = createContext<ReadonlySet<string>>(new Set());
