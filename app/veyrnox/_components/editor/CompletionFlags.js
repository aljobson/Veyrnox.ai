'use client';
import { createContext,useContext } from 'react';
const Flags=createContext({localInference:false,organization:false,scenes:false,clipper:false,agent:false});
export function CompletionFlagsProvider({localInference,organization,scenes,clipper,agent,children}){return <Flags.Provider value={{localInference:localInference===true,organization:organization===true,scenes:scenes===true,clipper:clipper===true,agent:agent===true}}>{children}</Flags.Provider>;}
export const useEditorCompletionFlags=()=>useContext(Flags);
