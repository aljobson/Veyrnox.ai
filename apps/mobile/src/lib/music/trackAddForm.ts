import type { TrackAddParameters, TrackAddMode } from './trackAddTypes';
export const initialTrackAddParameters: TrackAddParameters = {
    mode: 'vocals', prompt: '', lyrics: '', vocal_gender: 'auto', lyrics_rights_confirmed: false,
};
export const switchTrackAddMode = (parameters: TrackAddParameters, mode: TrackAddMode): TrackAddParameters => (
    parameters.mode === mode ? parameters
        : { ...parameters, mode, lyrics: '', vocal_gender: 'auto', lyrics_rights_confirmed: false }
);
