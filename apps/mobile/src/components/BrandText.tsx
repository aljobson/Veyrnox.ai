import { Fragment, type ReactNode } from 'react';
import { Text as NativeText } from 'react-native';
import { fonts } from '../theme';

// The Veyrnox.ai name as it prints inside a label or heading: VEYRNOX.ai in the logo's weight (900).
// Put the result inside a Text; the rest of the string is left as written. Running sentences keep the plain name.
export function brandText(text: string): ReactNode[] {
    return text.split(/(Veyrnox\.ai)/).map((part, i) => (
        part === 'Veyrnox.ai'
            ? <NativeText key={i} style={{ fontFamily: fonts.displayBlack, fontWeight: '900' }}>VEYRNOX.ai</NativeText>
            : <Fragment key={i}>{part}</Fragment>
    ));
}
