import { useState, useSyncExternalStore, type SetStateAction } from 'react';
import { brandStore } from './publishBrand';

type NetworkText = Readonly<Record<string, string>>;
const initial = (brand: string | null) => ({ brand, off: false, networkText: {} as NetworkText });

export function useBrandScopedVariants() {
    const brand = useSyncExternalStore(brandStore.subscribe, brandStore.get, () => null);
    let [state, setState] = useState(() => initial(brand));
    if (state.brand !== brand) {
        state = initial(brand);
        setState(state);
    }
    function setNetworkText(value: SetStateAction<NetworkText>) {
        if (brand !== brandStore.get()) return;
        setState((s) => {
            const current = s.brand === brand ? s : initial(brand);
            return current.off ? current : { ...current, networkText: typeof value === 'function' ? value(current.networkText) : value };
        });
    }
    function markOff(forBrand: string | null) {
        if (forBrand !== brandStore.get()) return;
        setState({ brand: forBrand, off: true, networkText: {} });
    }
    return { off: state.off, networkText: state.networkText, setNetworkText, markOff };
}
