'use client';

import { createContext, useContext } from 'react';

const ProjectsFlag = createContext(false);

// The same request-time server flag controls Studio, saving and the project APIs.
export function ProjectsFlagProvider({ enabled, children }) {
    return <ProjectsFlag.Provider value={enabled === true}>{children}</ProjectsFlag.Provider>;
}

export function useProjectsEnabled() {
    return useContext(ProjectsFlag);
}
