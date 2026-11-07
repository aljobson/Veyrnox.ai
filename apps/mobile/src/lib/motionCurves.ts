import { Easing } from 'react-native';

// Named curves for the first-launch motion. The built-in easings are too weak; these are the stronger ones the motion rules
// ask for. Never ease-in on UI: it starts slowly at the moment the person is watching most closely.
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1); // things arriving or leaving
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1); // things moving across the screen
