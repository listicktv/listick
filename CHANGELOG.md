# Changelog

## [0.11.0](https://github.com/listicktv/listick/compare/v0.10.1...v0.11.0) (2026-10-25)


### Features

* History cards show the run of episodes watched in a row, as S1 E16–17 ([b87df44](https://github.com/listicktv/listick/commit/b87df440a31c46d5004b1fb6e42861480aecbed7))


### Bug Fixes

* an episode Stremio queues after the last one ends no longer shows as watching ([b87df44](https://github.com/listicktv/listick/commit/b87df440a31c46d5004b1fb6e42861480aecbed7))
* History cards drop the Listick logo ([b87df44](https://github.com/listicktv/listick/commit/b87df440a31c46d5004b1fb6e42861480aecbed7))
* History run of episodes, Stremio queued episode ([b87df44](https://github.com/listicktv/listick/commit/b87df440a31c46d5004b1fb6e42861480aecbed7))

## [0.10.1](https://github.com/listicktv/listick/compare/v0.10.0...v0.10.1) (2026-10-24)


### Bug Fixes

* Stremio stays watching past 70 % until the video ends ([a5ced1f](https://github.com/listicktv/listick/commit/a5ced1f0c4a4086b60e4212f3759cf61228ad0c6))

## [0.10.0](https://github.com/listicktv/listick/compare/v0.9.4...v0.10.0) (2026-10-24)


### Features

* Continue watching for Jellyfin and Seanime ([89fd3a8](https://github.com/listicktv/listick/commit/89fd3a80092090e41586bcec24e6d3c4860549c3))
* Up next follows a rewatch of a finished show, tagged REWATCH ([89fd3a8](https://github.com/listicktv/listick/commit/89fd3a80092090e41586bcec24e6d3c4860549c3))
* what's playing in Stremio, Jellyfin and Seanime shows in Up next ([89fd3a8](https://github.com/listicktv/listick/commit/89fd3a80092090e41586bcec24e6d3c4860549c3))


### Bug Fixes

* Stremio shows as watching within a minute and stops 4 minutes after its last save ([89fd3a8](https://github.com/listicktv/listick/commit/89fd3a80092090e41586bcec24e6d3c4860549c3))

## [0.9.4](https://github.com/listicktv/listick/compare/v0.9.3...v0.9.4) (2026-10-23)


### Bug Fixes

* AniList and MAL Sync send each episode ([6343553](https://github.com/listicktv/listick/commit/634355389d1aa22031bb10e89e1bfd234597d606))

## [0.9.3](https://github.com/listicktv/listick/compare/v0.9.2...v0.9.3) (2026-10-23)


### Bug Fixes

* patched esbuild for drizzle-kit ([402db6a](https://github.com/listicktv/listick/commit/402db6a482ef03db2e450da95f4110f7826eecf5))

## [0.9.2](https://github.com/listicktv/listick/compare/v0.9.1...v0.9.2) (2026-10-23)


### Bug Fixes

* Stremio plays recorded when they end, on any day ([9877f0e](https://github.com/listicktv/listick/commit/9877f0e903048860a10138b20fdc955f15eb5198))

## [0.9.1](https://github.com/listicktv/listick/compare/v0.9.0...v0.9.1) (2026-10-23)


### Bug Fixes

* catalogs ask TMDB again for a recent title's missing IMDb id ([458e3b7](https://github.com/listicktv/listick/commit/458e3b7405fd3c60ccc764ad0dea35613ca339b5))
* Stremio catalogs switch a title from 2025 on from tmdb: to its IMDb id once TMDB has one (checked once a day) ([458e3b7](https://github.com/listicktv/listick/commit/458e3b7405fd3c60ccc764ad0dea35613ca339b5))

## [0.9.0](https://github.com/listicktv/listick/compare/v0.8.1...v0.9.0) (2026-10-23)


### Features

* AniList and MyAnimeList sync in Settings ([2bb954b](https://github.com/listicktv/listick/commit/2bb954b14b2644e7140fb962499122a76a430bc5))
* ANILIST_CLIENT_ID and ANILIST_CLIENT_SECRET; MAL_CLIENT_ID also turns on MyAnimeList Sync ([2bb954b](https://github.com/listicktv/listick/commit/2bb954b14b2644e7140fb962499122a76a430bc5))
* Settings › Connections › AniList and MyAnimeList: connect, Sync now, disconnect, last sync ([2bb954b](https://github.com/listicktv/listick/commit/2bb954b14b2644e7140fb962499122a76a430bc5))
* started and completed dates from History on synced entries ([2bb954b](https://github.com/listicktv/listick/commit/2bb954b14b2644e7140fb962499122a76a430bc5))
* Sync copies anime progress from History, only raising an entry (more episodes or Completed) ([2bb954b](https://github.com/listicktv/listick/commit/2bb954b14b2644e7140fb962499122a76a430bc5))

## [0.8.1](https://github.com/listicktv/listick/compare/v0.8.0...v0.8.1) (2026-10-22)


### Bug Fixes

* connection setup steps folded until opened ([facdb32](https://github.com/listicktv/listick/commit/facdb320f950223ed47e76c7331f76799a5937c1))

## [0.8.0](https://github.com/listicktv/listick/compare/v0.7.0...v0.8.0) (2026-10-22)


### Features

* every anime list for Seanime ([1715cc7](https://github.com/listicktv/listick/commit/1715cc732ee302b7a3c3d8abb306b4bd1ae7ec04))

## [0.7.0](https://github.com/listicktv/listick/compare/v0.6.0...v0.7.0) (2026-10-22)


### Features

* Seanime connection ([e6a7000](https://github.com/listicktv/listick/commit/e6a70005fd2d10645302d6f0f2638839f14646a0))


### Bug Fixes

* Airing calendar level with the first row ([cc4b7e2](https://github.com/listicktv/listick/commit/cc4b7e26bd1aff4c5c5158ed60d45b8268d6296a))
* connection setup steps ([1991289](https://github.com/listicktv/listick/commit/19912895c5bc7a47162ee53e5a5968f8cb2b460a))

## [0.6.0](https://github.com/listicktv/listick/compare/v0.5.0...v0.6.0) (2026-10-22)


### Features

* Jellyfin tracking through its Webhook plugin ([5da2b0f](https://github.com/listicktv/listick/commit/5da2b0fd7b0362836c49a15e820908de7bed994b))
* watching now on Continue watching, posters, the title window and episodes ([5da2b0f](https://github.com/listicktv/listick/commit/5da2b0fd7b0362836c49a15e820908de7bed994b))


### Bug Fixes

* security hardening ([135f679](https://github.com/listicktv/listick/commit/135f679848a6bdaf5a1ce9862245327ead6f18cb))
* skip Stremio progress while still playing ([e099b38](https://github.com/listicktv/listick/commit/e099b3830ab9c69bfb88e8a2f5f3f164b895da78))
* watching tags on phone ([91b27b9](https://github.com/listicktv/listick/commit/91b27b96ed648a933d439622abe89d8957954195))

## [0.5.0](https://github.com/listicktv/listick/compare/v0.4.0...v0.5.0) (2026-10-22)


### Features

* episode names, stories and images TMDB lacks from TheTVDB ([62a98c6](https://github.com/listicktv/listick/commit/62a98c69014f797c576bd19d79a9aab8f3e614c6))
* episode stills show their story on hover and a watched tick ([ff0b581](https://github.com/listicktv/listick/commit/ff0b58125b71e66f4a5f3b98a5112c3dac2d000e))
* food, travel, game show and home makeover list presets ([62a98c6](https://github.com/listicktv/listick/commit/62a98c69014f797c576bd19d79a9aab8f3e614c6))
* imported episodes placed by their own ids, or by air date when the numbering differs ([ded7387](https://github.com/listicktv/listick/commit/ded7387244a8d26ec94a19347ac864f8b1314b94))
* Next up beside the season's episodes in the title window ([ff0b581](https://github.com/listicktv/listick/commit/ff0b58125b71e66f4a5f3b98a5112c3dac2d000e))
* phone Streaming heading picks the service ([ff0b581](https://github.com/listicktv/listick/commit/ff0b58125b71e66f4a5f3b98a5112c3dac2d000e))
* TheTVDB categories for smart lists ([62a98c6](https://github.com/listicktv/listick/commit/62a98c69014f797c576bd19d79a9aab8f3e614c6))
* TheTVDB seasons for shows it splits differently, switched in the season menu ([ded7387](https://github.com/listicktv/listick/commit/ded7387244a8d26ec94a19347ac864f8b1314b94))


### Bug Fixes

* circle rings drawn evenly on scaled screens ([ff0b581](https://github.com/listicktv/listick/commit/ff0b58125b71e66f4a5f3b98a5112c3dac2d000e))
* episode page circles and arrows match the season line ([ff0b581](https://github.com/listicktv/listick/commit/ff0b58125b71e66f4a5f3b98a5112c3dac2d000e))
* kids anime rows no longer empty after a failed Kitsu lookup ([ff0b581](https://github.com/listicktv/listick/commit/ff0b58125b71e66f4a5f3b98a5112c3dac2d000e))
* the menu says Shows instead of TV ([ded7387](https://github.com/listicktv/listick/commit/ded7387244a8d26ec94a19347ac864f8b1314b94))

## [0.4.0](https://github.com/listicktv/listick/compare/v0.3.0...v0.4.0) (2026-10-22)


### Features

* episode page with the still beside its story ([ff16e22](https://github.com/listicktv/listick/commit/ff16e22cb550774b131bf0f1411bd4c040b1220f))
* new Episodes tab in the title window ([ff16e22](https://github.com/listicktv/listick/commit/ff16e22cb550774b131bf0f1411bd4c040b1220f))
* phone Episodes tab with a full-width Next up ([ff16e22](https://github.com/listicktv/listick/commit/ff16e22cb550774b131bf0f1411bd4c040b1220f))
* row arrows light up in the swipe direction on touch screens ([ff16e22](https://github.com/listicktv/listick/commit/ff16e22cb550774b131bf0f1411bd4c040b1220f))
* row pages show their count as a circle, with smaller sort circles and title ([ff16e22](https://github.com/listicktv/listick/commit/ff16e22cb550774b131bf0f1411bd4c040b1220f))


### Bug Fixes

* row titles line up with their circles ([ff16e22](https://github.com/listicktv/listick/commit/ff16e22cb550774b131bf0f1411bd4c040b1220f))
* title window keeps one height when switching tabs ([ff16e22](https://github.com/listicktv/listick/commit/ff16e22cb550774b131bf0f1411bd4c040b1220f))
* unaired episodes show the show's backdrop ([ff16e22](https://github.com/listicktv/listick/commit/ff16e22cb550774b131bf0f1411bd4c040b1220f))

## [0.3.0](https://github.com/listicktv/listick/compare/v0.2.0...v0.3.0) (2026-10-22)


### Features

* accent bar on row titles; smoother card corners ([f8ee681](https://github.com/listicktv/listick/commit/f8ee6814c201f3341daa9779dd4f76c4fcc2f5c3))
* ring arrows and a see-all circle on row headers ([756c88c](https://github.com/listicktv/listick/commit/756c88ca1fdffc5575ee54e681895ed1fe46c30c))

## [0.2.0](https://github.com/listicktv/listick/compare/v0.1.0...v0.2.0) (2026-10-21)


### ⚠ BREAKING CHANGES

* list items carry IMDb ids; the metadata routes go

### Features

* list items carry IMDb ids; the metadata routes go ([2ec38e4](https://github.com/listicktv/listick/commit/2ec38e4411e7fef42966feac9797b6ba6307769c))

## 0.1.0 (2026-10-21)


### Features

* initial release ([68f5207](https://github.com/listicktv/listick/commit/68f520730dd28cc6173d6bcffaa8648cfdba715a))
