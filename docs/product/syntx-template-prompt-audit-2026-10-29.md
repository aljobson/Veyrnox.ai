# Syntx video-template prompt audit — 29 October 2026

## Result

Veyrnox now contains 98 video templates linked to licensed Syntx community trends. Records were matched using the public read-only Trends API and the source media identifiers retained with each template.

- **97 exact source prompts are complete.** Their verbatim text is stored in the Syntx source-record modules, loaded as the template-page prompt, returned by `/api/presets`, and locked by full SHA-256 fixtures.
- **1 source prompt remains unresolved:** `keyboard-duo-swap`. Its licensed media file is still reachable, but Syntx no longer returns its source record. Veyrnox keeps a null exact-source prompt rather than inventing text.
- **60 new Syntx video templates were added in this audit:** the earlier 20-record batch and a further 40 exact prompt/video pairs. Their source prompts and source media are distinct from the previously recorded Syntx set.
- **9 older Syntx-derived Veyrnox templates were recovered into the exact-prompt audit.**
- **Independent source-file evidence is locked for the 9 recovered and 60 new records.** Each downloaded Syntx variant has a full SHA-256 in `syntxSourceAssetHashes.mjs`; all 69 source downloads are byte-unique. The nine recovered provenance rows were reconstructed from the public Trends API on 29 October rather than assumed to be records made at their original import.
- **2 exact-prompt duplicate groups are documented:** `who-was-that-business` / `curtain-reveal`, and `event-character-swap` / `rap-takeover`. Each pair represents different preview placements associated with the same underlying Syntx trend; the local videos remain different.
- **All 98 local Syntx preview videos are byte-unique.** The additional 40 also have distinct normalized five-second visual signatures, both within their batch and against the 58 previously recorded Syntx previews.
- Exact source prompts are displayed and loaded byte-for-byte when a verified template is selected. They remain marked non-runnable where they exceed provider limits or require source-video/reference inputs the current public generation route does not accept; the shorter `veyrnox-adaptation` value remains separate fallback metadata.
- Verbatim creator text can contain third-party references. For example, `pizzeria-hide-and-seek` names a game franchise in its exact read-only source prompt. The owner requested exact copying; Veyrnox does not edit that provenance text, while the editable Veyrnox adaptation uses an original neutral mechanical mascot.

The complete source record, exact prompt, source-media URL, source-file hash, normalized visual signature, local preview hash and rejection ledger for the additional 40 are in the [machine-readable 40-record manifest](source-audit/syntx-40-2026-10-29.json). Candidate selection rejected 39 records already present, four normalized prompt duplicates and four records without a complete same-record prompt/video pair.

## Historical batch exclusions

The 14 October PR also added eight wall previews: `agamemnon`, `blue-depth`, `cyclope`, `fairytale-castle`, `infinite-clones`, `moonwalk`, `skatedog` and `windows`. PR [#969](https://github.com/aljobson/Veyrnox.ai/pull/969) did not identify their source platform, and none has an exact title or slug match in the 206 video records returned by the current Syntx Trends API. They are therefore not represented as Syntx records and retain null exact-source prompts rather than being assigned text by title similarity. In particular, Fairytale Castle is not the current Dreamworks Castle media: a five-second comparison between their local previews produced SSIM `0.756953`, far below the `>0.95` recovered-media match threshold.

This exclusion is a provenance conclusion, not a claim that their private origin is known. If an original licensed media URL is recovered later, it must be matched by media evidence before any exact prompt is attached.

## Renamed source entries

These neutral Veyrnox template names differ from the current Syntx trend title. The public Veyrnox names remain unchanged; the exact source title and slug stay in provenance.

| Veyrnox template | Current Syntx source title |
| --- | --- |
| `event-character-swap` | Viral Rap Takeover |
| `rap-takeover` | Viral Rap Takeover |
| `curtain-reveal` | Who was that? Business |
| `character-takeover` | Rich in 30 Days |
| `escalator-loop` | Escalator Vibe |
| `blood-moon-dance` | Vampire Blood Moon |
| `red-thread-story` | The Red Thread |
| `meal-together` | A Meal Made Together |
| `sheep-kingdom` | Among Sheep |
| `fashion-catch` | Catch the Look |

## Earlier completion matrix

The table below covers the original 58 audited records. The linked machine-readable manifest above is the completion matrix for the additional 40 and is verified by the same regression contract.

| Veyrnox template | Batch | Syntx source title | Exact prompt | Matched media ID | Prompt SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `medieval-runway-look` | Existing | Medieval Runway Look | Complete | `Uz4mSaF5whThHf4UxXBl86UBGyelRKtdkn3PMtj5` | `de1ef4dd0b3a0b0b520d72ae95ea7186eeb1051b67dbf79f7c252fdef91d78c0` |
| `keyboard-duo-swap` | Existing | Keyboard Duo Swap | Unresolved; public source entry unavailable | `uCxc5t2yK9MJEjxzKtevpNdeMw6yYQyIzxHJiqZY` | — |
| `shadow-warriors` | Existing | Shadow Warriors | Complete | `v0IWqxKDem6ob6kWb4WEfa5uEaeCiT5izzJ66fVb` | `bef144410977912e72a3e5bfa3ef22dd9040d05a8bf9ba2e318bfeef6ee1317e` |
| `storm-starring` | Existing | Storm Starring | Complete | `sKDvnDudRdlWCuHRBLBzPR4WBnsYDcxk1wVgazUr` | `9bf19dae3dda6d373a24274107adc944f26430daebdd1d8adb4dce8a477b7270` |
| `epic-train-doorway-scene` | Existing | Epic Train Doorway Scene | Complete | `D32W06o9qJoCOHnFxtLC6BH9Lvftpyaf6sD75RBD` | `27a74afc19f26da3d8932d5fcff53e70e0085cd0cc98348968e1bb187472c7da` |
| `fat-parkour` | Existing | Fat Parkour | Complete | `xAXfvbGmMPLFCk6AHfqkew9D5k2KomNk3fVZdZZo` | `45b24b5c95499cf3a79c52e11d56c674c12e516252db13c802bd6a638ea9118d` |
| `crazy-frog-race` | Existing | Crazy Frog Race | Complete | `1yALI02uHd8mdSUDqWMWvFHagMDaKMbGr1ja55gB` | `0a093b072e24baf6898435fee9b8e68eb72b5b338545582f5fa304e7e119e6d1` |
| `the-push` | Existing | The Push | Complete | `PWzjzgOZCwLDPT9E28a7cEsJ2ylDVN37zJIKpEWX` | `18063bd66668e6ce6309dd186025de11c1b1757d19b25204ad2572daad482bf1` |
| `dreamworks-castle` | Existing | Dreamworks Castle | Complete | `nhbAJzO7cngEHWm0HpyupSPbUSd3zhYkJI0SqeTQ` | `c972202f86cd34bfae8663ed7bfed198c2d43cefafde02f59d9dd5c55a61e46a` |
| `a-moment-between-strangers` | Existing | A Moment Between Strangers | Complete | `ZIHALUhjLlXzmqu1ScRKcF00CaztsLlYoweeuLbd` | `607c20a89104d36c7e442be97fa0158842b1f3b3bbf4ea4d0ea1d0bc786c5ca6` |
| `the-last-stagecoach` | Existing | The Last Stagecoach | Complete | `om40sLJ19J3k1oTRX48KPV8CJihmHZY28WWjMYev` | `71b1f31ef9dc44b6123876ea2b08ef9024201d1469a7480aec8f2452c715d222` |
| `jellyfish-airlines` | Existing | Jellyfish Airlines | Complete | `kkFbiXcjaS7Zn1J55xlPjgOXFalnAn7arge07BZv` | `1d390d91d6604fa2225b722dc39cca0c09348191a7e1ce8c41f18bd71162eb69` |
| `dandelion-ball` | Existing | Dandelion Ball | Complete | `tsCtUsPSPTTG69sAaQj1PUe9pqB1CqEBWvXLSPIz` | `980413712dd3f450f34877e241950271718911c0faa95608523ff4d825ca4089` |
| `sm-brand-new-day` | Existing | SM: Brand New Day | Complete | `045JrMYwhs7xRpdiIZB3TjITBjVX1P4FLniwIfMj` | `e94fc7cb8e53e8b78f533e36abac72cfa4700d7bf9a8a12e3c5a984f1ddbc581` |
| `who-was-that-business` | Existing | Who was that? Business | Complete | `MwhzJoqQycAsEDuCPgPxrjI88Y39J1g5pRTqCH2u` | `e42964672dad218a79856da960ebadee81b815189a53ab2d1fb2fc5529e4ca12` |
| `trick-or-skin` | Existing | Trick or Skin | Complete | `zaYfIC1D02bQck4RIdU4uHaPrhIHuKnVtz3gwjT6` | `a61e98936ddeebad92b73682c791e46724aace0c68e15072d972c310387ff8bd` |
| `the-wrong-one` | Existing | The Wrong One | Complete | `gUUIJ3nDMG1ddMFo62W9JESljWZHxyQFHr6xZCHl` | `ba52787792cef48a9bdd5f8d37c42cf2f5388fbdd03cea60366e9ab4a77f7d96` |
| `event-character-swap` | Existing | Viral Rap Takeover | Complete | `xYiIvO9c3Z6twpkbKiuzt6gjS5cde5PeaCtLawe8` | `6ee76073d5b8cf00cd583f68d05de36020bf6f45dcb15761063424c68efa4e8b` |
| `curtain-reveal` | Existing | Who was that? Business | Complete; duplicate of who-was-that-business | `MpwEhL4jUVA0GFrduEONJ8pgbimuW862BVszSwsv` | `e42964672dad218a79856da960ebadee81b815189a53ab2d1fb2fc5529e4ca12` |
| `character-takeover` | Existing | Rich in 30 Days | Complete | `2EbVbiK0Bypw71il6nn4IXIBL8Wd6cZpB3bxsFDb` | `61eea153db9372da9bb0234f5aee7fbba673c878eba3862957e6a74827c712cf` |
| `escalator-loop` | Existing | Escalator Vibe | Complete | `BaAZGUzSuLF0o5vAj9XKcvvOFQQDpPehGsfBew8z` | `ea8e672e62f9bce27d67f649e671cdf41b8667185716580693e6ba487b6cd15d` |
| `blood-moon-dance` | Existing | Vampire Blood Moon | Complete | `NAVfzuYkyTWvyiRha2J8GQCjUfgmZ22a5a9OHALi` | `fbe259ddfb99b32771a46c696083d6a29643b265405393539f1530b42fdd735c` |
| `red-thread-story` | Existing | The Red Thread | Complete | `4Bk6SfPvZW5MRnAbcNmAre7CXdtOEML2i4UTI7jE` | `cabc8c0803dfbf95d37dc5f7f6d3244a191781a8eea70c034045ee3e5f9dfcf9` |
| `meal-together` | Existing | A Meal Made Together | Complete | `8cFD6QEwDOWvmxUtrqtzFnaHdYyptp9jNtYC7BoO` | `aa9abc36461f5b8922236520ddd8f17ce444612c5d0cf8c841c2335c05353cec` |
| `tentacle-breakout` | Existing | Tentacle Breakout | Complete | `qoEMQ7cU2DtoMUViUl9QUzmmQu201HL4ap6G8Zt3` | `5c409e69134ce17dee8e88c2f7e55460b8b5d75f1e449cecd9c9d84e8b017596` |
| `sheep-kingdom` | Existing | Among Sheep | Complete | `prHMOoBBsjBRYmsqZM4e6PY6nNVcyKXtaZRUYm8m` | `d97847bb80f6a1207f1d0b7ee894dfb1db3a635122b7cb94f2910ae6f8c08b3c` |
| `pumpkin-night` | Existing | Pumpkin Night | Complete | `HLT1ZxijsxEcuDy5SFOqR4eGixgfZlphZ0wofy3A` | `88923585398dc3968d47e60195e4ab8345888445283c6b182bc8601506f31f9c` |
| `fashion-catch` | Existing | Catch the Look | Complete | `9xWMcI5PT1Clb27KF6FVdNl9iP0RPGfu6cHWBfTt` | `86a333bd4226c6e07b5d9749e1154855f1cbbb9cd6517d7b961a96f7d117b174` |
| `desert-train-heist` | Existing | Desert Train Heist | Complete | `LwC1bYg2nRihXesJYJi9Uv584QBVkkYoPSWR8pci` | `5d963c22acab61fbda6e358576cf70906b4f934032660f3727e19e0f491fe356` |
| `enchanted-forest-selfie` | Recovered older | Enchanted Forest Selfie | Complete | `CsuAzWhBaCehzu0FWel0ximC8UNVF7qPHgYderwY` | `804d8e7e67401d2d0282937466072e5a4e53c2359ea786d542818bb5eb9c1c9b` |
| `pumpkin-lings` | Recovered older | Pumpkin Lings | Complete | `srXEpo3w1MPqK3idWOOTEV4Nj25HmN8Yx82R7vB3` | `14bd3c32d46915a1532c976e34917a73451df5b98ee55959c48808bb8315799a` |
| `dont-blow-out-the-pumpkin` | Recovered older | Dont Blow Out the Pumpkin | Complete | `6fnFeD0MAoZwRNDdYbG8t7gJy0g8YYqn4hoTj182` | `0bbbaf4d9ef2cecf55266192dbcf15c5782f96bc934c3519acdf7b3409148b27` |
| `rap-takeover` | Recovered older | Viral Rap Takeover | Complete; duplicate of event-character-swap | `d8XOPNIyVQhqaAqi1ZTp02NgLd4f9iXudPC9V80T` | `6ee76073d5b8cf00cd583f68d05de36020bf6f45dcb15761063424c68efa4e8b` |
| `urban-broomstick-flight` | Recovered older | Urban Broomstick Flight | Complete | `P6czZt58dOY1BRGmlTUhxgw2cTPGpp1pMN3XIPOV` | `b7b213f8886eaf0cd42629bba901e0717ea557983e92f53143476e4e32f28df3` |
| `hotel-window-watch` | Recovered older | Hotel Window Watch | Complete | `KYYmCkc1tNLb5nM28OZZPwY7B0cr56ZAGw8dboFD` | `0bdd1fa7cba14c88e28588c2f55690bca4f1908892e9bf587d7d6b052c9dbf23` |
| `broomstick-flight` | Recovered older | Broomstick Flight | Complete | `sSW0kE7uR7qQnPFL5YNY7Nw7VuzNglXzMb7KjMjN` | `52365faaace896f3544926800d773538ac6a3f3270e679f831aaf2aba8023f6d` |
| `money-flex` | Recovered older | Money Flex | Complete | `lhxne3YkajHKOCeVKBtqnsQX8asHMzLXsKA6zask` | `1eb6f40dc2afff10e6dfdb2f77c7a469f08e87deec399e391dce065e715cebb4` |
| `epic-slap-knockout` | Recovered older | Epic Slap Knockout | Complete | `xoHtXupdxlfkOHmi3hlgo9vcUEypw3KjTqa9qXcS` | `87e13cf108e7afdf10cb89833d67677781616df80cd647945ac39a42a2d279fc` |
| `beyond-gravity` | New 20 | Beyond Gravity | Complete | `3nmo1ecs09ey8QsXd5om7MKMnXfk1PbYfrB6KW4Y` | `9480fbef694248305859b4d9ffb3242f9e6d4d720966a8958b61a19616c58f60` |
| `chasing-you` | New 20 | Chasing You | Complete | `936paa1yZ88zTI4HauSs7rmTNUagBbUIsoWI5GT5` | `1770a652eff00963387cb4557cf922adeb1ab9b4762a121982e36659beca3100` |
| `cinematic-showcase-2` | New 20 | Cinematic Showcase 2 | Complete | `jz7ek3hBuY3WbDoPGhGbIVih5E36zIvoSuqifTtG` | `5e9e55a91f4b30b81ef3a258f28f7c6ecec49b4b60bb46f35957fff5273f84d2` |
| `cinematic-showcase` | New 20 | Cinematic Showcase | Complete | `nGCqOgGauF7er0SyXVcDsuxGXwZAo1SDHzXEyR2c` | `de7794360d7200f359a52806c03ceb2409022a4676d089fa81d0b255ae67f70a` |
| `basketball-3` | New 20 | Basketball 3 | Complete | `s1Y6FSUm3drtg2uXIP3460rIzEuJ3thPu7LpJUMF` | `3315de3604cb663c080de74ce1058eb7dc1d2df7094b87bb6047e1be59118217` |
| `reality-shift` | New 20 | Reality Shift | Complete | `6ovJbjdqgFRLZFVZnq8lBA2HToMEwc87ItQBcXjX` | `1fc545c1a0e0a97f365a281b509bdf47b34760da665b0264434669a71c6afea2` |
| `live-stage-performance` | New 20 | Live Stage Performance | Complete | `v0kxaDTu5UzA0bnoUZb0yoRNcx4jiJ5NNDKoh8CT` | `9830a94a483764a5ceb4477568bb33eb9d2e246d16d5d91e413a9614811a80cb` |
| `football` | New 20 | Football | Complete | `XUnsbiH8rr1mKhrbAjgZYYtZc1P4zkhotPZYQILw` | `19190dbfab42d2a6ae34a4dbd588ef440e724e7a3178d69936e2d4736245f3c1` |
| `brixton` | New 20 | Brixton | Complete | `bku3IwUZE6XqsjTHJklWgKBO3jNMxybJiWTiSikK` | `5e792985f7fe12481e6ff8c4d2b12e6022e62ffac5a70d04a7d5ed66f5dc8790` |
| `unforgettable` | New 20 | Unforgettable | Complete | `dDPr66nb5eeJU5VPczzhAuAg6V4GQecQsop69FHo` | `91a3f2c1906fee28d1304c20cdaa8ef1fadacb64c81715c3d3649e88d64e0210` |
| `natural-viral-makeover` | New 20 | Natural Viral Makeover | Complete | `k2Hh5tnywqGnPy176teBcX4zWCoUkvHUYOcXIJDk` | `195f2b86f409e7091345be318cb4c7b880c8bca4c7aa2e8be7643b6ed5f3cdd5` |
| `freestyle` | New 20 | Freestyle | Complete | `iIX3F1vmApu4HOwWpi2Ggqs1ced76b7YlGkBZtPM` | `6d252616f1133e9ebcdd2f6b77726184ef5fee67fc455ec86902a4ef72a11778` |
| `the-lost-chase` | New 20 | The Lost Chase | Complete | `xdmxorkIS2zgOefj0f6gvKM6VUWae9qo49tOeBJ2` | `58cd01a31efa438e3a6fef1da26de0c1b0619f43b6d5a6c0eedd7eb70e6e338b` |
| `burning-bridges` | New 20 | Burning Bridges | Complete | `sJ8Hr6y6OxDGCXZbRp75Gwgb6HMrVtpLaLHeIllq` | `6fd996fb1ba92bed34b7d051c91421acb05c480854355a496815bf1712f3ce10` |
| `retro-hip-hop-spotlight` | New 20 | Retro Hip-Hop Spotlight | Complete | `Mds81zGQ9jQykQqWnBdXCHzehVwU37JoPY0ZIHhh` | `28c9cb053035255efaef019a6476ab568b6c06d8ceb3457a44d720bb062c8817` |
| `wheelie-rider` | New 20 | Wheelie Rider | Complete | `D3tDuWYCrWpWmjF4JNdzsunJU1ZFBOnZWpx5rNsd` | `2be7b31d30898c816366599e033008d4d1d46e8665cf2f7fac0e32d5e00e540a` |
| `mystery-unboxing` | New 20 | Mystery Unboxing | Complete | `J0KYcvFxJcZLPJYAdNCZpVwijtuo8jPkhd5pvCo6` | `2a7a68c925a68efce5d3612b33aead26638d5e321cb7856b87b60cfa0fa0a632` |
| `whiskey-gun-trick` | New 20 | Whiskey Gun Trick | Complete | `emNGKUgDso20h7ndqDWNSazFBVXtL5IXvd9wJgRy` | `711f6a12fa20cad6f3fccc874c10fc3995ca359a7265bb00d206d5ea443b4748` |
| `cyber-mask-transformation` | New 20 | Cyber Mask Transformation | Complete | `PT0xEPWfx9gGtgH5ugveikCpTKOX6GuOhn976fTO` | `9ad057c46ad72f4fea54c87da6ec33673679c0796da586d0a4f1a6a0752684bc` |
| `pizzeria-hide-and-seek` | New 20 | Pizzeria Hide and Seek | Complete | `fnH4DicY8yYNdUA5XqtNaEnJvROIya7QNPdNBBf3` | `9b57e9a88d805e89fa8b6c9b43b9ea5de1c9b6208e7cb9b9af076bdcb7af73da` |

## Verification contract

The regression suite checks:

1. all 98 Syntx-linked source IDs have audit records;
2. all 97 available prompt strings match their locked SHA-256 values byte-for-byte;
3. the only exact prompt duplicates are the two documented groups;
4. Keyboard Duo remains explicitly unresolved with a null source prompt;
5. all 98 local preview-video SHA-256 values are different, and the additional 40 normalized visual signatures are distinct;
6. the 69 recovered/new downloaded source variants match their locked source-asset SHA-256 evidence;
7. all 97 exact prompts reach the public API, while the unresolved Keyboard Duo record stays outside every public template surface; and
8. runnable generation prompts remain within the supported 2,000-character boundary.

This audit used Syntx’s public read-only Trends API on 29 October 2026. It did not run a paid generation or infer private prompts.
