import type { ImageSourcePropType } from 'react-native';
import { networkLabel } from './publishCompose';

export type NetworkKey = 'gmb' | 'twitch' | 'bluesky' | 'pinterest' | 'threads' | 'facebook' | 'instagram' | 'linkedin' | 'twitter' | 'tiktok' | 'youtube';
export const NETWORK_LOGOS: Record<NetworkKey, ImageSourcePropType> = {
    gmb: require('../../assets/networks/gmb.png'),
    twitch: require('../../assets/networks/twitch.png'),
    bluesky: require('../../assets/networks/bluesky.png'),
    pinterest: require('../../assets/networks/pinterest.png'),
    threads: require('../../assets/networks/threads.png'),
    facebook: require('../../assets/networks/facebook.png'),
    instagram: require('../../assets/networks/instagram.png'),
    linkedin: require('../../assets/networks/linkedin.png'),
    twitter: require('../../assets/networks/twitter.png'),
    tiktok: require('../../assets/networks/tiktok.png'),
    youtube: require('../../assets/networks/youtube.png'),
};
export const networkName = (key: string): string => key === 'twitch' ? 'Twitch' : networkLabel(key);
