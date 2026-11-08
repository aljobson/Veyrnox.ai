import { useEffect, useState } from 'react';
import { API_BASE } from './api';
import { fetchTemplateContract, templateContract } from './templateFidelity';

// A direct Create link may arrive before the feed has been read. Fetch only its
// detail, retaining the original source independently of the editable route text.
export function useTemplateContract(id: string | null | undefined) {
    const [loaded, setLoaded] = useState<{ id: string; done: boolean } | null>(null);
    const [attempt, setAttempt] = useState(0);
    const contract = templateContract(id);
    useEffect(() => {
        if (!id || templateContract(id)) return;
        let live = true;
        fetchTemplateContract(id, API_BASE)
            .then(() => { if (live) setLoaded({ id, done: true }); })
            .catch(() => { if (live) setLoaded({ id, done: true }); });
        return () => { live = false; };
    }, [id, attempt]);
    return { contract, retry: () => { setLoaded(null); setAttempt(value => value + 1); }, loading: !!id && !contract && !(loaded?.id === id && loaded.done) };
}
