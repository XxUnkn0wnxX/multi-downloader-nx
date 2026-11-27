# 🎬 Anime Downloader NX

**AniDL** is a command-line downloader for Crunchyroll, HIDIVE and Animation Digital Network (ADN). You can search for a show, choose episodes, audio and subtitles, and save the result as MKV or MP4. Available titles and tracks depend on the service, region and account.

**[🚀 Get started with the CLI](GET-STARTED.md)** · [🔑 Sign in to a service](AUTHENTICATION.md)

**Browse** · [Setup](#setup) · [Services](#services) · [CLI options](ARGUMENTS.md) · [Changelog](CHANGELOG.md) · [Releases](../../../releases) · [Issues](../../../issues)

This fork follows [anidl/multi-downloader-nx](https://github.com/anidl/multi-downloader-nx). `main` is the stable branch. Changes on `develop` are available for testing before release. [Fork changes](fork-changes.md) · [🛠️ Developer guide](DEVELOPMENT.md)

[![Tests main](https://img.shields.io/github/actions/workflow/status/XxUnkn0wnxX/multi-downloader-nx/test.yml?branch=main&label=Tests%20main&style=flat-square)](../../../actions/workflows/test.yml?query=branch%3Amain)
[![Tests develop](https://img.shields.io/github/actions/workflow/status/XxUnkn0wnxX/multi-downloader-nx/test.yml?branch=develop&label=Tests%20develop&style=flat-square)](../../../actions/workflows/test.yml?query=branch%3Adevelop)
[![Discord](https://img.shields.io/discord/884479461997805568?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/qEpbWen5vq)

## Setup

Download the **Nightly Fork** CLI archive for your operating system and processor, then extract the whole archive. Builds target Windows, macOS, Linux and Alpine on x64 and arm64. Each includes its Node.js runtime. The macOS package uses Node 22 for Big Sur compatibility, and the other packages use Node 24. [Download the Nightly CLI](../../../releases/tag/nightly-fork)

Start with **Getting Started** to open a terminal, sign in and preview one Crunchyroll episode. The guide includes separate Windows and Linux commands and explains which tools you need to save the finished file. [Open the first-download walkthrough](GET-STARTED.md)

## Services

### Crunchyroll

Use `--service crunchy --device {type}` **(Crunchyroll only)** to sign in. Replace `{type}` with `androidtv` for Android TV or `android` for a phone or tablet. Search for a show and choose episodes from a season. [Crunchyroll sign-in](AUTHENTICATION.md#crunchyroll)

<details>
<summary><strong>Bitrate Q&amp;A</strong></summary>

| Series | Episode tested | Date checked (UTC) |
| --- | --- | --- |
| Sasaki and Peeps | [Season 2, episode 6 — Feast and Bonds](https://www.crunchyroll.com/watch/GE00328103ENUS/feast-and-bonds) | 25 November 2026 |

**Does the sign-in method change audio bitrate?** On this episode’s current stream, the browser cookie, Android phone and Android TV sign-ins all advertised the same audio bitrate for each dub. English and Japanese differed slightly.

**Can video bitrate differ?** Yes. Video bitrate can vary by dub and endpoint. On that episode, the Japanese dub offered a higher-bitrate video option than the tested English dub.

</details>

### HIDIVE

Use `--service hidive --auth` and enter your username or email and password when prompted. Search for a show, select episodes from a series or season, or use an episode ID. [HIDIVE sign-in](AUTHENTICATION.md#hidive-and-adn)

### AnimationDigitalNetwork (ADN)

Use `--service adn --auth` and enter your username or email and password when prompted. Search the French catalog by default, or choose German (`--locale de`) or Polish (`--locale pl`). Select episodes by show ID. [ADN sign-in](AUTHENTICATION.md#hidive-and-adn)

## Search and preview

The walkthrough takes you from a series search to a season ID, then shows the preview and its matching download command. [Find and download one episode](GET-STARTED.md#find-and-download-one-episode)

A download preview (`--dry-run`) works on all three services. It contacts the service for metadata and can refresh your login. It stops before downloading media, subtitles or fonts, muxing the output or marking an episode as downloaded.

## Build from source

For developers and advanced users, the [developer guide](DEVELOPMENT.md#build-from-source) explains how to run AniDL from a checkout and build the CLI locally.

## Fork builds and releases

On the release page, open **Assets** and download the file ending in `-cli.7z` for your platform. Its matching `.sha256` file lets you verify the download. [Nightly Fork downloads](../../../releases/tag/nightly-fork)

The release title shows the fork revision. To check your installed revision, look for the number after `Rev` in the AniDL startup banner. [Fork changelog](CHANGELOG.md)

## Fork update notices

Source and packaged CLI runs check for a newer published Nightly version at startup. The check reads GitHub release/package metadata and prints a download link; it does not install updates or download update packages. Successful lookups are cached for 24 hours, and a batch checks once before processing its episodes.

Use `--skipUpdate` or set `skipUpdate: true` in `config/cli-defaults.yml` to disable the check. The code default is `false`; previews and playback-status commands also skip it. A service command with `--update` prints the Nightly link and exits instead of installing anything.

For example, an installed Rev3 detecting published Rev4 prints:

```text
Fork update available: 5.8.8 (Nightly) [Rev3] -> 5.8.8 (Nightly) [Rev4]
	Download updates: https://github.com/XxUnkn0wnxX/multi-downloader-nx/releases/tag/nightly-fork
```

A newer base version takes precedence; Rev is compared only when the base version is equal. The check follows the completed release built from `main`, so an in-progress build does not create an early notice. [Fork update behavior](fork-changes.md#fork-update-notices)

## Legal warning

This application is not endorsed by or affiliated with _Crunchyroll_, _HIDIVE_ or _AnimationDigitalNetwork_. This application enables you to download videos for offline viewing which may be forbidden by law in your country. The usage of this application may also cause a violation of the _Terms of Service_ between you and the stream provider. This tool is not responsible for your actions; please make an informed decision before using this application.

Released under the [MIT license](../LICENSE.md).
