# Network logos

Brand silhouettes from Simple Icons 11.0.0; Bluesky from 12.4.0. CC0-1.0.
Sources: https://github.com/simple-icons/simple-icons/tree/11.0.0 and
https://github.com/simple-icons/simple-icons/tree/12.4.0.
The exact paths are in `app/veyrnox/app/publish/NetworkLogo.js` at the repository root.

Like `assets/icons`, these are white PNGs tinted with React Native Image's `tintColor`.
Render each 24×24 path with the existing canvaskit-wasm package in a throwaway Node
script outside the repository: MakeSurface(96, 96), clear to transparent, scale the
canvas by 4 in both axes, parse with Path.MakeFromSVGString, draw with an antialiased
paint filled #ffffff, flush, and encode the snapshot as PNG. Dispose the image,
path, paint and surface. No source SVG or runtime dependency is added.
