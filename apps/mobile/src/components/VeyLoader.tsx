import { LoadingState } from './LoadingState';

/** @deprecated Use LoadingState for new waiting UI. Kept while existing screens migrate. */
export function VeyLoader({ label, showLabel = false, width = 56 }: { label?: string; showLabel?: boolean; width?: number }) {
    return <LoadingState label={label} showLabel={showLabel} size={width <= 32 ? 'small' : 'large'} />;
}
