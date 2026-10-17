'use client';
import { createContext,useContext } from 'react';
const Flags=createContext({localInference:false,organization:false,scenes:false});
export function CompletionFlagsProvider({localInference,organization,scenes,children}){return <Flags.Provider value={{localInference:localInference===true,organization:organization===true,scenes:scenes===true}}>{children}</Flags.Provider>;}
export const useEditorCompletionFlags=()=>useContext(Flags);
