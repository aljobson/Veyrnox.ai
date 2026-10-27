import { Fragment } from 'react';
import { Text, type TextProps } from './Text';

// Keep the translated sentence and its punctuation; only the formatted price receives warning ink.
export function PriceText({ text, price, ...props }: Omit<TextProps, 'children'> & { text: string; price: string }) {
    if (!price) return <Text {...props}>{text}</Text>;
    return <Text {...props}>{text.split(price).map((part, index) => <Fragment key={index}>
        {index ? <Text variant={props.variant} tone="warning">{price}</Text> : null}{part}
    </Fragment>)}</Text>;
}
