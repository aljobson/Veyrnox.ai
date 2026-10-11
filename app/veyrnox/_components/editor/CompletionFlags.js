'use client';
import { createContext,useContext } from 'react';
const Flags=createContext({localInference:false,organization:false});
export function CompletionFlagsProvider({localInference,organization,children}){return <Flags.Provider value={{localInference:localInference===true,organization:organization===true}}>{children}</Flags.Provider>;}
export const useEditorCompletionFlags=()=>useContext(Flags);
