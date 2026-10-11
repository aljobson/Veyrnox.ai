'use client';
import { createContext,useContext } from 'react';
const Flag=createContext(false);
export function SharedToolsFlagProvider({enabled,children}){return <Flag.Provider value={enabled===true}>{children}</Flag.Provider>;}
export const useEditorSharedEnabled=()=>useContext(Flag);
