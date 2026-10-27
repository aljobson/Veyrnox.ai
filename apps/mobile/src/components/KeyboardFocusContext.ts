import { createContext } from 'react';
// A form scroll container supplies this; fields outside a form need no scrolling.
export const KeyboardFocusContext = createContext<(() => void) | null>(null);
