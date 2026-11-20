The three v*.fcproj fixtures are verbatim copies from storytold/filmcraft,
commit f67d38b35cc5af6853ef5a6921ccba014512694b, crates/format/tests/fixtures.
Source: https://github.com/storytold/filmcraft/tree/f67d38b35cc5af6853ef5a6921ccba014512694b/crates/format/tests/fixtures
MIT OR Apache-2.0; accompanying licences and NOTICE retained. No trademark grant.

v1 is the old bare-project format, outside P3's required envelope contract.
v8 includes marker 800000 but next_id 49: the strict P3 identity check refuses it.
v11 also lacks format and contains no sequence. These refusals are intentional golden outcomes, not
claims that FilmCraft refuses its own legacy fixtures.
