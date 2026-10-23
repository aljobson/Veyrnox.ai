# Landing showcase clips

Every landing feature card, every tile in the 24-template wall, all 110
public preset cards and the three model-category cards have viral previews. The owner requested footage and prompts from [SYNTX Trends](https://syntx.ai/trends),
[Higgsfield](https://higgsfield.ai/) and [CapCut](https://www.capcut.com/my-edit?start_tab=video) on 14 October 2026. This replaces the
previous requirement to use only clips generated on Veyrnox.

Imported clips are source previews. Frozen In Motion now uses the owner's
approved output generated through Veyrnox with its published template prompt.
Template clips now link to their own matching recipes and compatible remix
prompts (see [template recipes](template-recipes.md)). Imported tiles display a generic “Viral inspiration”
badge; the tested example displays “Generated on Veyrnox”. Public cards,
template data, page copy and media filenames contain no source-platform names,
links or credits. Internal provenance remains recorded in this document only.
Model-category and feature cards remain inspiration; template pages show only
the supported Veyrnox adaptation. Live credit prices come from the catalog.

On 23 October 2026 the gallery's discovery layer was aligned to the 11 generic
theme concepts visible on Crun's public AI Effects page: Pet, Style, Quirk Lab,
Morph Me, AI Dance, Soccer Fever, Super Power, E-commerce, Shot Language,
AI Gift and Festival. Only those short navigation concepts were referenced.
No Crun prompt, code, image, video, branding or hosted asset is shipped by
Veyrnox; every card still resolves to the existing Veyrnox recipe and media.

`app/veyrnox/_lib/showcase.js` maps all five `FEATURE_CARDS` keys and all
`PRESETS` clip keys to local videos, posters and neutral titles.
`MODEL_SHOWCASE_KEYS` selects three dedicated clips for the Video, Image and
Audio cards in `/#models`. `WALL_SHOWCASE_KEYS` selects 24 dedicated
homepage previews with their own recipes. The shared
`PresetCard` also brings the gallery previews to the studio Explore gallery.

All 142 public tile placements use different footage: five feature cards,
24 homepage template cards, three model-category cards and 110 gallery
cards. Product Hero 360 appears in the gallery while Miniature Crew has its own
landing template, prompt, video and poster, preserving distinct content across
surfaces as requested by the owner.

## Preview provenance

The table records the original public asset and the start of the five-second
excerpt. No audio is retained.

| Tile | Original preview | Source asset | Start |
| --- | --- | --- | --- |
| `product-hero-360` | Product Hero 360 | [CapCut inspiration](https://www.capcut.com/my-edit?start_tab=video&inspirationKey=7640056113873964309) | 0 s |
| `wall-product-hero-360` | Miniature Crew | [CapCut inspiration](https://www.capcut.com/my-edit?start_tab=video&inspirationKey=7675206348950244628) | 0 s |
| `birthday-rocket-launch` | Birthday Rocket | [Pexels](https://www.pexels.com/video/space-shuttle-taking-off-854253/) | 0 s |
| `candle-wish-world` | Candle Wish World | [Mixkit](https://mixkit.co/free-stock-video/cake-with-burning-candles-in-the-dark-5109/) | 0 s |
| `giant-age-adventure` | Giant Age Adventure | [Mixkit](https://mixkit.co/free-stock-video/birthday-party-table-with-balloons-falling-5101/) | 0 s |
| `dinosaur-birthday-parade` | Dino Party Parade | [Pexels](https://www.pexels.com/video/a-child-playing-with-toy-dinosaurs-8502991/) | 0 s |
| `underwater-birthday-kingdom` | Underwater Birthday Kingdom | [Mixkit](https://mixkit.co/free-stock-video/school-of-fish-swimming-4291/) | 0 s |
| `toybox-comes-alive` | Toybox Party | [Mixkit](https://mixkit.co/free-stock-video/father-and-son-with-a-didactic-toy-4553/) | 0 s |
| `monster-disco-party` | Monster Disco | [Mixkit](https://mixkit.co/free-stock-video/couple-on-the-dance-floor-having-fun-344/) | 0 s |
| `mini-cake-chef` | Mini Cake Chef | [Mixkit](https://mixkit.co/free-stock-video/a-chef-covering-dough-with-flour-1669/) | 0 s |
| `birthday-news-report` | Birthday News Flash | [Mixkit](https://mixkit.co/free-stock-video/microphone-viewed-closely-2850/) | 0 s |
| `party-invitation-trailer` | Party Invitation Trailer | [Mixkit](https://mixkit.co/free-stock-video/birthday-cake-on-a-table-with-candies-and-balloons-5111/) | 0 s |
| `growing-up-timeline` | Growing Up Timeline | [Mixkit](https://mixkit.co/free-stock-video/children-playing-with-a-dancing-fountain-3469/) | 0 s |
| `birthday-highlight-reel` | Birthday Highlight Reel | [Mixkit](https://mixkit.co/free-stock-video/taking-a-picture-of-a-birthday-table-with-a-smartphone-5106/) | 0 s |
| `wan-2.5-kie` | High flip | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/001156a7-cfdb-4e16-8f13-68c246ddc06c.mp4) | 4 s |
| `nano-banana-kie` | Medieval Runway Look | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/Uz4mSaF5whThHf4UxXBl86UBGyelRKtdkn3PMtj5.webm) | 8 s |
| `kling-26` | World morphing | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/950efc04-6ae6-4b31-bfa5-83c87244014c.mp4) | 2 s |
| `presets` | Street colossus | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/e0278141-12c9-4139-91eb-b4294d833ed9.mp4) | 2 s |
| `ace-step` | Keyboard Duo Swap | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/uCxc5t2yK9MJEjxzKtevpNdeMw6yYQyIzxHJiqZY.webm) | 0 s |
| `cctv-night` | Shadow Warriors | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/v0IWqxKDem6ob6kWb4WEfa5uEaeCiT5izzJ66fVb.webm) | 2 s |
| `sunset-drift` | Wild ride | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/8cd9e3fc-8e4f-4071-abff-8934f3381507.mp4) | 1 s |
| `neon-alley` | Storm Starring | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/sKDvnDudRdlWCuHRBLBzPR4WBnsYDcxk1wVgazUr.webm) | 18 s |
| `warm-portrait` | Studio slide | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/c129fb83-2014-4a37-a3f8-6c7dfeab0254.mp4) | 0 s |
| `film-portrait` | Epic Train Doorway Scene | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/D32W06o9qJoCOHnFxtLC6BH9Lvftpyaf6sD75RBD.webm) | 6 s |
| `talking-head` | Fat Parkour | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/xAXfvbGmMPLFCk6AHfqkew9D5k2KomNk3fVZdZZo.webm) | 8 s |
| `clean-cutout` | Cutout | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/a64711ac-93b8-46ee-a9ce-37ee5c18e148.mp4) | 1 s |
| `editorial-flatlay` | Floating fall | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/d877f71c-d2f3-44df-9317-f3ce6889bcb6.mp4) | 0 s |
| `street-portrait` | Eyes in | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/dba03734-6e8a-4337-acb4-17ce943563d8.mp4) | 0 s |
| `packshot-studio` | Smash and grab | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/c32886ee-2d15-4697-a366-041a9deaffe2.mp4) | 0 s |
| `try-the-look` | Incline | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/bade6252-7039-42eb-a50c-45c142c7f70f.mp4) | 0 s |
| `ugc-unboxing` | Selfception | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/6ef62a07-2609-4693-8225-e6263b76afab.mp4) | 0 s |
| `miniature-city` | Act natural | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/7a261cff-8d6c-4bab-84e7-515364061f3e.mp4) | 0 s |
| `product-hero` | Lacewalker | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/d806368c-0d8a-4a7b-b43a-8ff22fa64563.mp4) | 0 s |
| `noir-one-sheet` | Burning man | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/c370022d-d99a-4cff-bb35-9d73b7a3a95d.mp4) | 0 s |
| `saturday-cartoon` | Melting | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/f661157c-af00-46f7-8b7c-6a7ae711ef98.mp4) | 0 s |
| `anime-hero` | Crazy Frog Race | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/1yALI02uHd8mdSUDqWMWvFHagMDaKMbGr1ja55gB.webm) | 0 s |
| `photo-to-motion` | Frozen in motion | Veyrnox job `5c5755b0-83d8-4459-96c2-2732277f2bf6` (see below) | 0 s |
| `runway-walk` | Fallen angel | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/67a78431-c90b-4aa5-95c4-9069da87a173.mp4) | 1 s |
| `anime-opening` | Monster dab | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/0ab0fb19-95df-44c7-9b92-6804122e02ff.mp4) | 1 s |
| `portal-burst` | The Push | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/PWzjzgOZCwLDPT9E28a7cEsJ2ylDVN37zJIKpEWX.webm) | 1 s |
| `floating-castle` | Dreamworks Castle | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/nhbAJzO7cngEHWm0HpyupSPbUSd3zhYkJI0SqeTQ.webm) | 1 s |
| `model-video` | Bullet time | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/08dad223-9baf-4d51-a07d-07062cf392d9.mp4) | 1 s |
| `model-image` | Pearl earring | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/1565d8db-fefe-4934-a7e5-1f3800df0419.mp4) | 1 s |
| `model-audio` | Superstar | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/69352fc9-6a72-4197-b13d-969d906512ce.mp4) | 1 s |
| `wall-cctv-night` | Lidar transition | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/9a8e4804-9e49-4a3b-8087-021ba9b447cf.mp4) | 1 s |
| `wall-sunset-drift` | boarding pass | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/dcd67e05-0b1e-4475-9b6c-3f96e69c5384.mp4) | 1 s |
| `wall-neon-alley` | Architecture wave | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/0cc7ac70-a981-406b-aac6-1d9fcc06e218.mp4) | 1 s |
| `wall-talking-head` | Clones | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/9cedf121-64a9-4eb9-88e9-608844ff1929.mp4) | 1 s |
| `wall-clean-cutout` | Vanish | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/d63d47dd-d00f-42c8-9c45-9bddd3df7a38.mp4) | 0 s |
| `wall-warm-portrait` | A Moment Between Strangers | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/ZIHALUhjLlXzmqu1ScRKcF00CaztsLlYoweeuLbd.webm) | 1 s |
| `wall-film-portrait` | The Last Stagecoach | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/om40sLJ19J3k1oTRX48KPV8CJihmHZY28WWjMYev.webm) | 1 s |
| `jellyfish-airlines` | Jellyfish Airlines | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/kkFbiXcjaS7Zn1J55xlPjgOXFalnAn7arge07BZv.webm) | 0 s |
| `dandelion-ball` | Dandelion Ball | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/tsCtUsPSPTTG69sAaQj1PUe9pqB1CqEBWvXLSPIz.webm) | 0 s |
| `sm-brand-new-day` | SM: Brand New Day | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/045JrMYwhs7xRpdiIZB3TjITBjVX1P4FLniwIfMj.mp4) | 0 s |
| `who-was-that-business` | Who was that? Business | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/MwhzJoqQycAsEDuCPgPxrjI88Y39J1g5pRTqCH2u.mp4) | 0 s |
| `scrapbook-collage` | Scrapbook Collage | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/84f761d0-2033-417f-aee0-a2029cfb78fe.mp4) | 0 s |
| `stop-world` | Stop World | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/fd94af6b-adf5-4eb2-90f7-22e92e34bb5a.mp4) | 0 s |
| `earth-zoom` | Earth Zoom | [Higgsfield](https://cdn.higgsfield.ai/viral_hub_preset/d1b7d148-46a1-4e57-b808-4af2e8c823f1.mp4) | 0 s |
| `comic` | Comic | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/b2836797-7dc2-481c-8929-abc1ddbbb891.mp4) | 0 s |
| `wall-trick-or-skin` | Trick or Skin | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/zaYfIC1D02bQck4RIdU4uHaPrhIHuKnVtz3gwjT6.mp4) | 0 s |
| `wall-the-wrong-one` | The Wrong One | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/gUUIJ3nDMG1ddMFo62W9JESljWZHxyQFHr6xZCHl.mp4) | 0 s |
| `wall-pigeons` | Pigeons | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/95e80ebb-98d7-41d6-ad33-e81d405d9400.mp4) | 0 s |
| `wall-mighty-fighter` | Mighty Fighter | [Higgsfield](https://cdn.higgsfield.ai/viral_hub_preset/e68f7c19-0247-4832-9c7f-98807635b6bd.mp4) | 0 s |
| `city-trailer` | City Trailer | [CapCut](https://www.capcut.com/my-edit?start_tab=video) | 5 s |
| `city-vlog` | City Vlog | [CapCut](https://www.capcut.com/my-edit?start_tab=video) | 8 s |
| `floral-pool-portrait` | Floral Pool Portrait | [CapCut](https://www.capcut.com/my-edit?start_tab=video) | 0 s |
| `wall-behind-the-lens` | Behind the Lens | [CapCut](https://www.capcut.com/my-edit?start_tab=video) | 0 s |
| `paper-fragments` | Paper Fragments | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/4f884245-2915-4a24-a19a-b18cd252ab1f.mp4) | 0 s |
| `ink-sprint` | Ink Sprint | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/c3fcf814-6542-4b51-a704-3b76153c91c6.mp4) | 0 s |
| `motorcycle-double` | Motorcycle Double | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/f0eee690-e157-4188-bcaa-5670edaae510.mp4) | 0 s |
| `laundromat-monster` | Laundromat Monster | [Higgsfield](https://cdn.higgsfield.ai/viral_hub_preset/13be43ee-5c17-456f-a08c-1e2d1a13c718.mp4) | 0 s |
| `wall-sticker-peel-reveal` | Sticker Peel Reveal | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/c560128d-9812-4211-8d96-c1c5ce909f09.mp4) | 0 s |
| `wall-dolphin-surf-ride` | Dolphin Surf Ride | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/b9e49ad8-6009-44cc-84c4-06cd3ea71e24.mp4) | 0 s |
| `wall-event-character-swap` | Event Character Swap | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/xYiIvO9c3Z6twpkbKiuzt6gjS5cde5PeaCtLawe8.webm) | 8 s |
| `curtain-reveal` | Curtain Reveal | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/MpwEhL4jUVA0GFrduEONJ8pgbimuW862BVszSwsv.webm) | 10 s |
| `race-track` | Race Track | [Higgsfield](https://cdn.higgsfield.ai/viral_hub_preset/9f0c4caa-06f5-4e12-bb4f-a2a221a8afc8.mp4) | 0 s |
| `modern-montage` | Modern Montage | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/04bab337-d074-465d-9c5f-27e4eb270225.mp4) | 0 s |
| `vintage-montage` | Vintage Montage | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/9b029b09-f910-431e-94c0-b9ca6db41715.mp4) | 0 s |
| `action-figure` | Action Figure | [Higgsfield](https://cdn.higgsfield.ai/viral_hub_preset/b98ae9ed-ec67-4e73-8e1d-df440181e908.mp4) | 0 s |
| `paper-world` | Paper World | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/e908cd25-8fc5-43b5-9835-f5193fcb1d46.mp4) | 0 s |
| `broken-mirror` | Broken Mirror | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/20397c83-0280-4dc2-950c-5b72a548bd5f.mp4) | 0 s |
| `puffin-flight` | Puffin Flight | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/4616788e-abf2-45fd-bbde-23a92100ef70.mp4) | 0 s |
| `three-d-render` | 3D Render | [Higgsfield](https://cdn.higgsfield.ai/viral_hub_preset/d215b031-c484-405e-bb3e-79ae0912f0f8.mp4) | 0 s |
| `orbital-presence` | Orbital Presence | [Higgsfield](https://cdn.higgsfield.ai/viral_hub_preset/88c7e4e9-ffd1-44fa-8e70-91ddd6e3e756.mp4) | 0 s |
| `hand-painted` | Hand Painted | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/0adfa8b5-7e87-461b-90a8-5542a506d0f6.mp4) | 0 s |
| `origami-fold` | Origami Fold | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/4b844a70-1eb9-4ac2-b2ea-9e017f7fa31a.mp4) | 0 s |
| `orbit-360` | Orbit 360 | [Higgsfield](https://cdn.higgsfield.ai/viral_hub_preset/4b866a81-e773-4be5-b041-9dcad102e9b9.mp4) | 0 s |
| `toxic-glitch` | Toxic Glitch | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/9ea0e5af-9f30-4a2e-89ea-54fbf2ad4874.mp4) | 0 s |
| `marble-statue` | Marble Statue | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/f300c8f1-9071-4737-abd0-9f7dbd354519.mp4) | 0 s |
| `ultraviolet-night` | Ultraviolet Night | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/dd675cab-cc8e-4305-96b7-9a808df33321.mp4) | 0 s |
| `bubble-world` | Bubble World | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/6eee81db-e7d6-4794-9190-39d0a8c1693c.mp4) | 0 s |
| `acid-colour` | Acid Colour | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/d1cdb860-cff9-46de-b75f-4e821317bd30.mp4) | 0 s |
| `flash-comic` | Flash Comic | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/cd6524d8-d06f-4d6c-8883-9177b537840f.mp4) | 0 s |
| `radiant-glow` | Radiant Glow | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/7f697ee1-9df8-45c5-8523-005fb7482278.mp4) | 0 s |
| `lava-flow` | Lava Flow | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/d62537bf-2356-4131-90bb-c398a27c46c7.mp4) | 0 s |
| `duotone-motion` | Duotone Motion | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/70c0bc83-9ba2-49c5-9a5d-80fa7c118dcc.mp4) | 0 s |
| `particle-burst` | Particle Burst | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/27b85cfd-0747-4375-969f-b93eb9da19de.mp4) | 0 s |
| `canvas-paint` | Canvas Paint | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/ecdb540e-d1d6-4562-b29f-0bafe2961cdf.mp4) | 0 s |
| `motion-tracking` | Motion Tracking | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/c694ed05-d2b0-4850-a1e9-2b90dcee95d8.mp4) | 0 s |
| `prism-dream` | Prism Dream | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/f2163456-4099-4b1e-9f62-2d4953d2b7bf.mp4) | 0 s |
| `colour-palette` | Colour Palette | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/26bed71d-7789-4a45-8d95-7c01f1474ca1.mp4) | 0 s |
| `knights-diary` | Knight's Diary | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/eefdd4a1-d9d6-484a-b257-2bb5ccea9a3d.mp4) | 0 s |
| `magazine-cover` | Magazine Cover | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/f48ae4ba-635d-47ed-bbe5-0d519c009106.mp4) | 0 s |
| `overexposed-flash` | Overexposed Flash | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/2b60f7f8-19ab-4e0a-ad83-a96e4d4fb3d0.mp4) | 0 s |
| `multiverse-doors` | Multiverse Doors | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/f12b80d6-b7dc-48ac-8a77-8eadcee6e3ac.mp4) | 0 s |
| `impressionist-muse` | Impressionist Muse | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/c1782da6-1348-4f62-90a0-24c9ed57da91.mp4) | 0 s |
| `many-eyed-portrait` | Many-Eyed Portrait | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/b69c6fa1-ca41-4c26-9237-f59682eb991f.mp4) | 0 s |
| `cold-vision` | Cold Vision | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/a1a4d75a-b6e9-42fb-af01-be96d279b375.mp4) | 0 s |
| `sketch-world` | Sketch World | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/5e169eba-a6db-41a7-afed-d852615efc07.mp4) | 0 s |
| `lost-in-a-book` | Lost in a Book | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/fc52785d-4f15-4835-a4a0-003aa7c8ac88.mp4) | 0 s |
| `retro-paparazzi` | Retro Paparazzi | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/5ec2d059-facf-45a5-968c-7fa45b090a8a.mp4) | 0 s |
| `noir-city` | Noir City | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/9f68f799-81a0-47c0-8ed9-437a10c71cb9.mp4) | 0 s |
| `ocean-room` | Ocean Room | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/bcc94f8c-d4f6-4f1c-870c-258a98529418.mp4) | 0 s |
| `chromatic-surge` | Chromatic Surge | [Higgsfield](https://cdn.higgsfield.ai/mixed_media_preset/59a6a0fb-834e-4e86-b41e-5f21ce8ee55a.mp4) | 0 s |
| `penguin-flight` | Penguin Flight | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/b7ca03e3-5105-45e2-a674-f4e13d0f071c.mp4) | 0 s |
| `character-takeover` | Character Takeover | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/2EbVbiK0Bypw71il6nn4IXIBL8Wd6cZpB3bxsFDb.webm) | 0 s |
| `escalator-loop` | Escalator Loop | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/BaAZGUzSuLF0o5vAj9XKcvvOFQQDpPehGsfBew8z.webm) | 0 s |
| `blood-moon-dance` | Blood Moon Dance | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/NAVfzuYkyTWvyiRha2J8GQCjUfgmZ22a5a9OHALi.webm) | 0 s |
| `red-thread-story` | Red Thread Story | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/4Bk6SfPvZW5MRnAbcNmAre7CXdtOEML2i4UTI7jE.webm) | 0 s |
| `meal-together` | Meal Together | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/8cFD6QEwDOWvmxUtrqtzFnaHdYyptp9jNtYC7BoO.webm) | 0 s |
| `tentacle-breakout` | Tentacle Breakout | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/qoEMQ7cU2DtoMUViUl9QUzmmQu201HL4ap6G8Zt3.webm) | 0 s |
| `sheep-kingdom` | Sheep Kingdom | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/prHMOoBBsjBRYmsqZM4e6PY6nNVcyKXtaZRUYm8m.webm) | 0 s |
| `pumpkin-night` | Pumpkin Night | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/HLT1ZxijsxEcuDy5SFOqR4eGixgfZlphZ0wofy3A.webm) | 0 s |
| `fashion-catch` | Fashion Catch | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/9xWMcI5PT1Clb27KF6FVdNl9iP0RPGfu6cHWBfTt.webm) | 0 s |
| `desert-train-heist` | Desert Train Heist | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/LwC1bYg2nRihXesJYJi9Uv584QBVkkYoPSWR8pci.webm) | 0 s |

The 14 October expansion adds nine gallery previews—Enchanted Forest Selfie,
Pumpkin Lings, Don't Blow Out the Pumpkin, Rap Takeover, Urban Broomstick Flight,
Hotel Window Watch, Broomstick Flight, Money Flex and Epic Slap Knockout—and
eight landing-wall previews—Agamemnon, Blue Depth, Cyclope, Fairytale Castle,
Infinite Clones, Moonwalk, Skatedog and Windows. The original files were checked
against all existing previews before encoding; every resulting video and poster
has a different SHA-256. Public assets use only neutral `viral-*` filenames.

The later expansion adds eight gallery previews—City Trailer, City Vlog,
Floral Pool Portrait, Paper Fragments, Ink Sprint, Motorcycle Double,
Laundromat Monster and Curtain Reveal—and four landing-wall previews—Behind
the Lens, Sticker Peel Reveal, Dolphin Surf Ride and Event Character Swap.
Every public placement remains backed by a different source clip.

The 50-template expansion adds 40 transformation and visual-style recipes plus
10 cinematic and trend-driven recipes to the gallery. Each one has its own
neutral public name, adapted ten-second prompt, source-native preview crop and
local poster. The same SHA-256 uniqueness checks cover all 142 placements.

The kids-birthday expansion adds 12 gallery templates in a dedicated
`KIDS BIRTHDAY` category. The prompts are original Veyrnox adaptations of the
party formats identified during the source-platform review. Every preview is a
separate commercially reusable, watermark-free HD source; the inspected
source-platform previews were rejected because they contained baked-in
platform marks. Each card opens a ten-second direct recipe and can also carry
that edited prompt into Film Studio for a 30–120-second multi-shot project.

## Playback and budgets

- MP4, H.264 High profile, 24 fps, native dimensions preserved up to 1080 pixels on either side, no audio track.
- Five seconds per clip, encoded at CRF 20 (CRF 23 fallback only when needed); each video stays under `MAX_CLIP_BYTES` (6 MB).
- Representative JPG posters, each under 80 KB.
- Files live in `public/showcase/`, so the existing same-origin CSP applies.
- Desktop previews play on hover or keyboard focus while visible.
- Touch previews play one at a time while visible and stop within five seconds.
- Reduced motion, data saver and slow touch connections keep the poster still.
- Videos use `preload="none"`; playback failures keep the poster.

The existing `MediaTile` crops with `object-cover` into each tile's layout.
Encode at the source aspect ratio so the same preview can fit portrait,
landscape or wide tiles without distorting the subject.

```bash
ffmpeg -ss START -i original -t 5 -an \
  -vf "scale=w='min(1080,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=24" \
  -c:v libx264 -profile:v high -crf 20 -preset slow -pix_fmt yuv420p -movflags +faststart \
  public/showcase/SLUG.mp4
ffmpeg -ss POSTER_TIME -i public/showcase/SLUG.mp4 -frames:v 1 -q:v 4 public/showcase/SLUG.jpg
```

`tests/showcaseClips.test.mjs` checks local paths, file existence, budgets,
unique video paths, poster paths and video file hashes across the homepage
and gallery together, source credits and coverage of every landing tile,
public preset and model category. After a
replacement, also check the crop and hover/focus/touch behavior in a browser.

## Frozen In Motion generated example

On 10 October 2026 the owner approved replacing the imported
[Higgsfield preview](https://cdn.higgsfield.ai/viral_hub/59c46689-f756-4843-b298-f34b9761187e.mp4)
with the video tested in the Veyrnox studio. Job
`5c5755b0-83d8-4459-96c2-2732277f2bf6` used `kling-3.0-i2v` through FAL,
five seconds, 34 credits, the published prompt unchanged and its existing
negative prompt. The original starting image shows a fictional woman already
suspended mid-leap on a city sidewalk. Pedestrians move behind her as the
camera moves around her fixed pose. Slight hair and clothing drift remains.

The original H.264 output is 1080 x 1916, 24 fps, 5.041667 seconds, with
SHA-256 `09bbc79f2129aefe1636460a0b20c68172d3f87908dd51ab05a848dd3db7f539`.
Its five-second preview is scaled without cropping to 406 x 720, silent,
343,635 bytes, served from `/showcase/veyrnox-frozen-in-motion.mp4`, with
SHA-256 `e5434e1ce0d31e224cc2c3daf886584f734b441a3a837dc4c0b6a0633b665959`.
The matching JPG poster is the frame at 2.5 seconds. Both the gallery card
and template detail page share these assets. The old imported local video
and poster are removed. Higgsfield's original effect setup remains separately
documented as the inspiration for the Veyrnox adaptation.

## The landing film

The fifteen-second product film under the hero is separate. It shows the
Generate button, credit statement and price list. Its source and render
instructions remain in `scripts/landing-film/README.md`.

## The breakthrough video

The owner approved the branded robot version on 11 October 2026, replacing
the previous coffee clip in the opening video section, before the product
film and pricing hero.
A realistic white android hits the glass twice: the first punch cracks it,
the second breaks it outward, then its head and shoulders emerge toward the
viewer. The clip contains the official Veyrnox.ai mark and wordmark and a
large “DO YOU FEEL CREATIVE?” question. No crowd appears.

The current portrait and landscape animations were generated through Veyrnox
on 11 October 2026 with Kling 3.0 Pro image-to-video (`kie`, no audio),
28 Credits per five-second render. Portrait job
`d61b8b60-1fe7-4bc8-93e0-640ded264d19` and landscape job
`57859cc3-6b6e-47a4-8abf-8663faeeb06c` use matching starting references
with smooth, rigid, flat white chest armor. The owner approved the
100-Credit administrative grant recorded in ADR-0096; the two renders
consumed 56 Credits.

Both clips show a first impact that cracks the glass, a retraction, a second
impact that breaks it outward, and a forward head-and-shoulder breakout.
The final extended index finger emits cyan light. Exact typography was
composited locally: a white “DO YOU FEEL” line and larger aqua “CREATIVE?”
line with a translucent projection beam connected to the fingertip. The
hologram fades in from 3.6 to 4.0 seconds as the forward pose forms and stays
through a three-second final hold. It floats above the finger without
covering the face or hands. The official Veyrnox.ai mark and wordmark remain
at the top left throughout. The exports are silent, eight-second H.264 files.

`BREAKTHROUGH_FILM` serves `/film/robot-creative-v5.mp4` with its matching
JPG poster. The player spans the full viewport width immediately below the
navigation, with no outer padding, border or rounded frame. Desktop displays
the complete 1,280 × 720 landscape frame without cropping. Below 640px, it
selects `/film/robot-creative-portrait-v3.mp4` and its matching JPG poster.
The portrait animation is scaled to 720 × 1,280 with 80px of matching dark
background above and below, producing a 720 × 1,440 export. The complete
portrait frame is contained in the full-screen stage below the phone's
navigation, preserving both hands on other phone shapes too.

The mobile question is baked into the video, with no duplicate bottom
caption or large gradient obscuring the robot. “Start creating” remains a
separate accessible link at the bottom of the phone stage. The opening
announcement is hidden on phones so this hero fills the first screen.
Desktop keeps its creation link beneath the wide video; both links open
`/app/create`. The fifteen-second product film follows it.

The existing `FilmPlayer` supplies visible Play/Pause, pauses off screen,
leaves the poster still for reduced motion/data saver, and fetches the file
only when playback begins. Both videos remain under the 2 MB film budget;
posters remain under 150 KB. Posters use the final branded hologram pose.
