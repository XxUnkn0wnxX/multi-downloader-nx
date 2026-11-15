# 🎬 Anime Downloader NX

**AniDL** downloads episodes from **Crunchyroll**, **HIDIVE**, and **AnimationDigitalNetwork (ADN)** through a command-line interface or GUI. This is a fork of [anidl/multi-downloader-nx](https://github.com/anidl/multi-downloader-nx); its additions and compatibility fixes are documented in [Fork changes](fork-changes.md).

[![Tests](../../../actions/workflows/test.yml/badge.svg?branch=main)](../../../actions/workflows/test.yml) [![Discord](https://img.shields.io/discord/884479461997805568?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/qEpbWen5vq)

**Browse:** [Setup](#setup) · [Services](#services) · [CLI options](DOCUMENTATION.md) · [GUI guide](GET-STARTED.md) · [Changelog](CHANGELOG.md) · [Releases](../../../releases) · [Issues](../../../issues)

- Search catalogs and select individual episodes, ranges, or whole seasons/shows.
- Choose available dub and subtitle languages, including multiple audio tracks.
- Select video quality, customize filenames, and mux downloads into MKV or MP4.
- Preview a download's qualities and stream URLs with `--dry-run`.

Available titles, languages, and qualities depend on the provider, region, and account.

## Setup

Obtain a CLI archive from [Releases](../../../releases) when available, or [build from source](#build-from-source). Automated CLI builds target Windows, macOS, Linux, and Alpine, each for x64 and arm64. The GUI is built from source; the [Windows GUI guide](GET-STARTED.md) walks through its setup and use.

- **Media tools:** install [ffmpeg](https://www.videohelp.com/software/ffmpeg) and [MKVToolNix](https://www.videohelp.com/software/MKVToolNix). DRM decryption also needs [Bento4's `mp4decrypt`](https://www.bento4.com/downloads/) or [Shaka Packager](https://github.com/stratumadev/shaka-packager/releases).
- **CDM files:** these are not included. Supported Widevine files belong in `widevine/` and PlayReady files in `playready/`; see the [supported formats](GET-STARTED.md#cdm-files). CDM acquisition is outside this guide.
- **Source builds:** install [Node.js](https://nodejs.org/) 22 or newer and [pnpm](https://pnpm.io/) 10 or newer. Standalone CLI packages include their own runtime: Node 22 for macOS to retain the Big Sur baseline, and Node 24 for other targets.

Set executable locations in [`config/bin-path.yml`](../config/bin-path.yml) and save preferred options in [`config/cli-defaults.yml`](../config/cli-defaults.yml). The [CLI reference](DOCUMENTATION.md) lists supported settings and defaults.

## Services

The commands below assume `aniDL` is on your `PATH`. After a source build, use `node lib/index.js` in its place.

### Crunchyroll

**Log in:** `aniDL --service crunchy --device`, then approve the displayed code in your browser. Existing browser-cookie workflows remain documented under [`--token`](DOCUMENTATION.md#--token).

Search for a series, list its seasons, and select episodes with the dubs and subtitles you want. For raw DASH streams, discovery defaults to the selected audio languages and keeps their available video variants. `--qall` expands discovery to all available languages and shows the full quality list. It adds a default 750 ms after each normal batch, making the scan slower; its additional requests can trigger rate limits that affect normal viewing.

Legacy availability varies by episode and dub; advertised bandwidth is not measured file-average bitrate. Timing checks cannot prove identical edits or decoded synchronization, and `--bypasssync` skips video/audio timing checks with a risk of desynchronization. See [Crunchyroll streams and quality](GET-STARTED.md#crunchyroll-streams-and-quality) for quality labels, selection scope, and timing limits.

### HIDIVE

**Log in:** `aniDL --service hidive --auth`, then enter your username/email and password when prompted.

Search the catalog, choose episodes from a season, or select an individual episode by ID. Available audio tracks and subtitles can be chosen by language. The current HIDIVE implementation does not support the `--new` listing option.

### AnimationDigitalNetwork (ADN)

**Log in:** `aniDL --service adn --auth`, then enter your username/email and password when prompted.

Search for a show and select its episodes, audio versions, and subtitles. ADN supports the French, German, and Polish catalog locales through `--locale fr`, `--locale de`, and `--locale pl`; French is the default. Available languages depend on the title and catalog.

## Search and preview

After logging in, replace `SERVICE` with `crunchy`, `hidive`, or `adn`. Use a season ID for Crunchyroll or HIDIVE, or a show ID for ADN:

```sh
aniDL --service SERVICE --search "show name"
aniDL --service SERVICE -s ID -e 1,2 --dry-run
```

Remove `--dry-run` to download. Use the [CLI reference](DOCUMENTATION.md#downloading) to adjust episode selection, quality, audio languages, and subtitles.

Preview mode works across all three services. It stops before license requests, media/subtitle/font downloads, chapter output, decryption, muxing, and completed-download archive writes. Authentication and token refresh, metadata requests, required HEAD checks, logging, and GUI queue progression may still occur. `--debug` adds full request and manifest diagnostics.

For Crunchyroll episodes, `--tsd` or `tsd: true` can clear playback sessions when the account is full, including during a preview. Standalone `aniDL --service crunchy --tsd` force-clears listed sessions even with `--dry-run` or `--debug`; config alone does not trigger that standalone action. Use `aniDL --service crunchy --check-status` for a read-only status snapshot without playback or session clearing. See [Crunchyroll playback recovery](CRUNCHYROLL-RECOVERY.md) for capacity checks, status, waiting and retry limits. Clearing sessions does not log out and may not resolve a rate limit.

## Build from source

Copy this fork's clone URL from the **Code** menu, then install dependencies. The final command runs the CLI directly from TypeScript using your installed Node:

```sh
git clone <repository-clone-url>
cd multi-downloader-nx
pnpm install --frozen-lockfile
pnpm exec tsx index.ts --help
```

| Interface | Build JavaScript        | Run from the checkout      |
| --------- | ----------------------- | -------------------------- |
| CLI       | `pnpm run prebuild-cli` | `node lib/index.js --help` |
| GUI       | `pnpm run prebuild-gui` | `node lib/gui.js`          |

The GUI remains buildable, but it is not actively supported in this fork. Development and support focus on the CLI.

To package a standalone application, use a `build-{platform}-{arch}-{type}` script from [`package.json`](../package.json).

## Fork builds and releases

`main` is the stable default branch, `develop` is the working branch, and `master-upstream` mirrors upstream. [Tests](../../../actions/workflows/test.yml) checks Node 22 and 24. After a successful Tests run on `main`, [Nightly Fork](../../../actions/workflows/release-matrix.yml) builds that exact revision and checks that it is still current before publishing.

For a manual build of the current `main` commit, open **Actions → Nightly Fork → Run workflow** and select `main`. Documentation-only revisions can reuse the latest applicable passing Tests run on `main` when application, build, workflow, test, and dependency inputs are unchanged. Changed inputs require fresh passing Tests; a newer applicable failed or pending run blocks the manual build. Markdown-only and `docs/`-only changes skip automatic Tests, so this manual path can release those revisions without repeating unchanged source tests.

The workflow replaces eight `.7z` CLI archives and their checksums on the same **Nightly Fork** release page under the fixed `nightly-fork` tag. It is a normal release marked **Latest**. Release notes identify the released commit and the source revision validated by Tests separately, with links to the [fork changelog](CHANGELOG.md), Tests, and build run. GitHub also provides source ZIP and tar.gz downloads for the release tag. GUI packages remain a source-build option.

## Legal warning

This application is not endorsed by or affiliated with _Crunchyroll_, _HIDIVE_ or _AnimationDigitalNetwork_. This application enables you to download videos for offline viewing which may be forbidden by law in your country. The usage of this application may also cause a violation of the _Terms of Service_ between you and the stream provider. This tool is not responsible for your actions; please make an informed decision before using this application.

Released under the [MIT license](../LICENSE.md).
