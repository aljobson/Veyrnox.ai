'use client';

import { useEffect, useState } from 'react';
import { getSelectedSocialBrand, listSocialBrands, setSelectedSocialBrand } from '../../../lib/socialBrandClient.js';

export default function BrandSwitcher() {
  const [brands, setBrands] = useState(null);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    let active = true;
    listSocialBrands().then((result) => {
      if (!active) return;
      const available = result.brands || [];
      const stored = getSelectedSocialBrand();
      const current = available.some((brand) => brand.id === stored) ? stored : available[0]?.id || '';
      if (current !== stored) setSelectedSocialBrand(current);
      setSelected(current); setBrands(available);
    }).catch(() => { if (active) setBrands([]); });
    return () => { active = false; };
  }, []);

  if (!brands?.length) return null;
  const current = brands.find((brand) => brand.id === selected) || brands[0];
  if (brands.length === 1) return <p className="mb-5 text-xs text-vx-fg-muted">Brand: <strong className="text-vx-fg">{current.label}</strong> · {current.role}</p>;
  return <label className="mb-5 grid max-w-sm gap-1 text-xs font-bold text-vx-fg-muted">Working brand
    <select aria-label="Working brand" value={selected} onChange={(event) => {
      setSelectedSocialBrand(event.target.value);
      setSelected(event.target.value);
      window.location.reload();
    }} className="rounded-xl border border-vx-border bg-vx-panel px-3 py-2 text-sm text-vx-fg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent">
      {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.label} · {brand.role}</option>)}
    </select>
  </label>;
}
