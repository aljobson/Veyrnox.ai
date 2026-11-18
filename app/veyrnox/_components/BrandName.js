import { Fragment } from 'react';

const NAME = 'Veyrnox.ai';

// The Veyrnox.ai name as it prints on its own (a heading, a link, a label): VEYRNOX.ai in bold, the logo's weight.
// The name stays written out in the source, as the children of BrandName or in a translated label, so the
// product-knowledge and copy scans still read it; the visible text is VEYRNOX.ai. Running sentences keep the plain name.
export function withBrandName(text) {
  return String(text).split(new RegExp(`(${NAME.replace(".", "\\.")})`)).map((part, i) => (
    part === NAME
      ? <span key={i} className="font-black tracking-[-0.01em]">VEYRNOX<span>.ai</span></span>
      : <Fragment key={i}>{part}</Fragment>
  ));
}

export function BrandName({ children = NAME }) {
  return <>{withBrandName(children)}</>;
}
