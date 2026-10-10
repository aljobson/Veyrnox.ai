'use client';

import { createContext, useContext } from 'react';

const EditorFlag = createContext(false);

// The request-time server flag controls both the route and its Studio link.
export function EditorFlagProvider({ enabled, children }) {
    return <EditorFlag.Provider value={enabled === true}>{children}</EditorFlag.Provider>;
}

export function useEditorEnabled() {
    return useContext(EditorFlag);
}
