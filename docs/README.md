# 🎬 Anime Downloader NX

**AniDL** downloads episodes from Crunchyroll, HIDIVE, and AnimationDigitalNetwork. This fork of [anidl/multi-downloader-nx](https://github.com/anidl/multi-downloader-nx) includes CLI and GUI workflows; [Fork changes](fork-changes.md) tracks its additions.

[![Style and build test](../../../actions/workflows/test.yml/badge.svg)](../../../actions/workflows/test.yml) [![Discord](https://img.shields.io/discord/884479461997805568?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/qEpbWen5vq)

**Browse:** [Getting started](GET-STARTED.md) · [CLI options](DOCUMENTATION.md) · [Fork changes](fork-changes.md) · [Build from source](#build-from-source) · [Issues](../../../issues) · [Releases](../../../releases)

## Legal warning

This application is not endorsed by or affiliated with *Crunchyroll*, *Hidive* or *AnimationDigitalNetwork*. This application enables you to download videos for offline viewing which may be forbidden by law in your country. The usage of this application may also cause a violation of the *Terms of Service* between you and the stream provider. This tool is not responsible for your actions; please make an informed decision before using this application.

## Quick start

Obtain a CLI archive from [Releases](../../../releases) when available, or [build from source](#build-from-source), then install the tools listed under [Requirements](#requirements). The examples assume `aniDL` is available on your `PATH`; after a source build, use `node lib/index.js` in its place.

```sh
# Crunchyroll CLI login
aniDL --service crunchy --device

# Search for a series
aniDL --service crunchy --search "show name"

# Download episodes from a season
aniDL --service crunchy -s SEASON_ID -e 1,2
```

For other services, use `--auth` when prompted. Crunchyroll CLI login uses `--device`; the old `--auth`, username/password, and `--silentAuth` paths direct CLI users to device login. The browser-cookie `--token` option remains for existing workflows. See [the option reference](DOCUMENTATION.md#--token) for its accepted inputs.

## Crunchyroll quality selection

For raw DASH streams, the numbered quality list can include compatible video from the current and legacy manifests. Each entry shows `[Current M]` or `[Legacy M]` and its source language, such as `[eng]` or `[jpn]`. Resolution headings group the list; quality numbers continue across groups. The default `-q 0` selects the highest dimensions, then the highest advertised bandwidth; explicit numbers select individual entries. The highest current audio rendition is selected independently for each requested dub.

The chosen row ends with `<-- Selected`. If it is replaced during fallback, only the old row marked `<-- Discarded` and the replacement marked `<-- Re-selected` are printed, alongside the short reason. The full list is not repeated.

Quality-list rates use decimal `kb/s` (1 kb/s = 1,000 bits/s). `KiB/s` measures 1,024 bytes/s.

Cross-language choices are checked against declared video timing. A failed or incomplete check falls back to the requested version. The check does not prove decoded synchronization or identical edits. A short notice names the fallback video language and reason; `--debug` keeps the full check details. Legacy discovery relies on older manifest families that Crunchyroll may stop serving. Availability varies by episode, dub, and stream, and advertised bandwidth is not a file's average bitrate.

`--forcevideo` (alias `--forcevid`) bypasses timing eligibility and may cause audio/video desynchronization. `--noaudio` skips the timing check because no audio will be muxed. Subtitle cue times are not used for timing.

## Preview a download

Use `--dry-run` to inspect available qualities and stream URLs without requesting licenses or downloading media, subtitles, fonts, or chapter files. It also skips decryption, muxing, and completed-download archive writes.

```sh
aniDL --service crunchy -s SEASON_ID -e 1 --dry-run
```

Authentication and token refresh, metadata requests, required HEAD checks, logging, and GUI queue progression may still occur. Add `--debug` to see full request and manifest diagnostics.

## Requirements

Install [Node.js](https://nodejs.org/) 22 or newer and [pnpm](https://pnpm.io/) 10 or newer to run or build from source. Download and install [ffmpeg](https://www.videohelp.com/software/ffmpeg) and [MKVToolNix](https://www.videohelp.com/software/MKVToolNix) for media processing. For DRM decryption, install either [Bento4's `mp4decrypt`](https://www.bento4.com/downloads/) or [Shaka Packager](https://github.com/stratumadev/shaka-packager/releases).

The application does not include CDM files. Supported Widevine files belong in `widevine/`; supported PlayReady files belong in `playready/`. CDM acquisition is outside this guide. Executable paths can be set in [`config/bin-path.yml`](../config/bin-path.yml).

CLI defaults can be stored in [`config/cli-defaults.yml`](../config/cli-defaults.yml); the [option reference](DOCUMENTATION.md) shows which settings are available there.

## Build from source

Use the **Code** menu on this repository page to copy its clone URL. Replace `<repository-clone-url>` below with that URL:

```sh
git clone <repository-clone-url>
cd multi-downloader-nx
pnpm install
```

Run the CLI from TypeScript:

```sh
pnpm exec tsx index.ts --help
```

Build JavaScript with `pnpm run prebuild-cli` or `pnpm run prebuild-gui`. After the CLI build, run `node lib/index.js --help`; after the GUI build, run `pnpm start`. Package a target with `pnpm run build-{platform}-{arch}-{type}`; the available targets are listed in [`package.json`](../package.json). Build from this checkout's `develop` branch for its fork-specific features; upstream builds may not include them. This repository's release archives are listed only when available on its [Releases page](../../../releases).

See [Getting started](GET-STARTED.md) for the Windows GUI walkthrough and [the CLI option reference](DOCUMENTATION.md) for all flags and defaults.

Released under the [MIT license](../LICENSE.md).
