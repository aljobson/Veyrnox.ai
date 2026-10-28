import { Image } from 'react-native';
import { NETWORK_LOGOS, type NetworkKey } from '../../lib/networkLogos';
import { tokensForScheme } from '../../theme';
import { useAppearance } from '../ui/AppearanceContext';

export function NetworkLogo({ network, size = 16 }: { network: string; size?: 16 | 20 | 24 }) {
    const { settings, scheme } = useAppearance();
    if (!Object.prototype.hasOwnProperty.call(NETWORK_LOGOS, network)) return null;
    return <Image source={NETWORK_LOGOS[network as NetworkKey]} accessibilityElementsHidden importantForAccessibility="no"
        style={{ width: size, height: size, tintColor: tokensForScheme(scheme, settings).textPrimary }} />;
}
