import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { fetchFreeAllowance, type FreeLeft } from './freeAllowance';

// Free runs left today per model (ADR-0069). Empty while the server has the allowance off, while loading, or when
// the read fails: the screen then shows catalog prices only. The server decides what is free.
export function useFreeLeft(): FreeLeft {
    const { api } = useAuth();
    const [left, setLeft] = useState<FreeLeft>({});
    useEffect(() => {
        let live = true;
        fetchFreeAllowance(api)
            .then((v) => live && setLeft(v))
            .catch(() => live && setLeft({}));
        return () => {
            live = false;
        };
    }, [api]);
    return left;
}
