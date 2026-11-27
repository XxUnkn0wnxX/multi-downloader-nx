# 🎬 Anime Downloader NX

**AniDL** is a command-line downloader for Crunchyroll, HIDIVE and Animation Digital Network (ADN). You can search for a show, choose episodes, audio and subtitles, and save the result as MKV or MP4. Available titles and tracks depend on the service, region and account.

**[🚀 Get started with the CLI](GET-STARTED.md)** · [🔑 Sign in to a service](AUTHENTICATION.md) · [📖 CLI options](DOCUMENTATION.md) · [📝 Changelog](CHANGELOG.md)

This fork follows [anidl/multi-downloader-nx](https://github.com/anidl/multi-downloader-nx). `main` is the stable branch. Changes on `develop` are available for testing before release. [Fork changes](fork-changes.md)

[![Tests](../../../actions/workflows/test.yml/badge.svg?branch=main)](../../../actions/workflows/test.yml) [![Discord](https://img.shields.io/discord/884479461997805568?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/qEpbWen5vq)

## Setup

Download the **Nightly Fork** CLI archive for your operating system and processor, then extract the whole archive. Builds target Windows, macOS, Linux and Alpine on x64 and arm64. Each includes its Node.js runtime. The macOS package uses Node 22 for Big Sur compatibility, and the other packages use Node 24. [Download the Nightly CLI](../../../releases/tag/nightly-fork)

Start with **Getting Started** to open a terminal, sign in and preview one Crunchyroll episode. The guide includes separate Windows and Linux commands and explains which tools you need to save the finished file. [Open the first-download walkthrough](GET-STARTED.md)

## Services

### Crunchyroll

With the default settings, sign in once for Android TV (video) and once for Android phone (audio), using the same account. A browser cookie works for Chrome or Firefox streams. [Choose your Crunchyroll sign-in](AUTHENTICATION.md#crunchyroll)

By default, AniDL looks for qualities in your selected audio languages. **Crunchyroll only** — `--qall` checks all available languages and displays the full quality list. The extra requests take longer and can trigger rate limits. [Crunchyroll streams and quality](GET-STARTED.md#crunchyroll-streams-and-quality)

### HIDIVE

Use `--service hidive --auth` and enter your username or email and password when prompted. Search for a show, select episodes from a series or season, or use an episode ID. Use search to find titles on HIDIVE, which does not support the `--new` listing. [HIDIVE sign-in](AUTHENTICATION.md#hidive-and-adn)

### AnimationDigitalNetwork (ADN)

Use `--service adn --auth` and enter your username or email and password when prompted. Search the French catalog by default, or choose German (`--locale de`) or Polish (`--locale pl`). Select episodes by show ID. [ADN sign-in](AUTHENTICATION.md#hidive-and-adn)

## Search and preview

The walkthrough takes you from a series search to a season ID, then shows the preview and its matching download command. [Find and download one episode](GET-STARTED.md#find-and-download-one-episode)

A download preview (`--dry-run`) works on all three services. It contacts the service for metadata and can refresh your login. It stops before downloading media, subtitles or fonts, muxing the output or marking an episode as downloaded.

**Crunchyroll only** — `--check-status` shows a read-only playback status snapshot. If you enabled `--tsd` or set `tsd: true`, even a download preview can clear playback sessions when the account is full. [Playback status and recovery](CRUNCHYROLL-RECOVERY.md)

## Build from source

Install [Node.js](https://nodejs.org/) 22 or newer and [pnpm](https://pnpm.io/) 10 or newer. Run these commands to open CLI help from a checkout.

```sh
git clone https://github.com/XxUnkn0wnxX/multi-downloader-nx.git
cd multi-downloader-nx
pnpm install --frozen-lockfile
pnpm exec tsx index.ts --help
```

To compile the CLI, run `pnpm run prebuild-cli`. From the checkout, use `node lib/index.js` in place of `aniDL.exe` or `./aniDL` in the guides and keep the same options. Standalone packaging scripts are listed in [package.json](../package.json).

## Fork builds and releases

`main` is the stable default branch, `develop` is the working branch, and `master-upstream` mirrors upstream. [Tests](../../../actions/workflows/test.yml) checks Node 22 and 24. After a successful Tests run on `main`, [Nightly Fork](../../../actions/workflows/release-matrix.yml) builds that exact revision and checks that it is still current before publishing.

For a manual build of the current `main` commit, open **Actions → Nightly Fork → Run workflow** and select `main`. Documentation-only revisions can reuse the latest applicable passing Tests run on `main` when application, build, workflow, test, and dependency inputs are unchanged. Changed inputs require fresh passing Tests; a newer applicable failed or pending run blocks the manual build. This manual path can release documentation-only revisions without repeating unchanged source tests.

Automatic Tests skips changes limited to Markdown, `docs/` and/or `tools/`. Changes to downloader source, dependencies, build configuration or workflows still run the normal checks. The separate maintenance tools stay outside the application’s TypeScript, ESLint, Prettier and packaging scans; their tests run locally only.

The workflow replaces eight `.7z` CLI archives and their checksums on the same release page under the fixed `nightly-fork` tag. Its title includes the manually maintained fork revision, for example **Nightly Fork (Rev7)**, and it remains a normal release marked **Latest**. Release notes identify the released commit and the source revision validated by Tests separately, with links to the [fork changelog](CHANGELOG.md), Tests, and build run. GitHub also provides source ZIP and tar.gz downloads for the release tag.

Provider banners display the base version, channel and revision, for example `5.8.8 (Nightly) [Rev7]`. A service command with `--version` prints the base version for compatibility. Maintainers update the shared metadata in [package.json](../package.json). See [fork revision maintenance](fork-changes.md#nightly-revision-metadata).

## Fork update notices

Source and packaged CLI runs check for a newer published Nightly version at startup. The check reads GitHub release/package metadata and prints a download link; it does not install updates or download update packages. Successful lookups are cached for 24 hours, and a batch checks once before processing its episodes.

Use `--skipUpdate` or set `skipUpdate: true` in `config/cli-defaults.yml` to disable the check. The code default is `false`; previews and playback-status commands also skip it. A service command with `--update` prints the Nightly link and exits instead of installing anything.

For example, an installed Rev3 detecting published Rev4 prints:

```text
Fork update available: 5.8.8 (Nightly) [Rev3] -> 5.8.8 (Nightly) [Rev4]
	Download updates: https://github.com/XxUnkn0wnxX/multi-downloader-nx/releases/tag/nightly-fork
```

A newer base version takes precedence; Rev is compared only when the base version is equal. The check follows the completed release built from `main`, so an in-progress build does not create an early notice. See [fork update maintenance](fork-changes.md#fork-update-notices) for lookup and cache behavior.

<details>
<summary>⭐ TODO: Maintenance tools</summary>

Planned utilities in [`tools/`](../tools/) will help maintain Crunchyroll’s `basic_auth_token` and HIDIVE’s `hd_new_apiKey` / `hd_apikey` by:

- Downloading the latest suitable Crunchyroll or HIDIVE Android APK with `--dl`, or reusing one cached APK per service, then decompiling and extracting current app authentication tokens.
- Keeping ignored work folders and append-only token histories by app version/build, skipping identical entries.
- Providing `--help`, a shared Python environment, dedicated docs and local-only tests.

The folder, ignore rules and separation from application checks/builds are prepared; the scripts are not implemented yet.

</details>

## Legal warning

This application is not endorsed by or affiliated with _Crunchyroll_, _HIDIVE_ or _AnimationDigitalNetwork_. This application enables you to download videos for offline viewing which may be forbidden by law in your country. The usage of this application may also cause a violation of the _Terms of Service_ between you and the stream provider. This tool is not responsible for your actions; please make an informed decision before using this application.

Released under the [MIT license](../LICENSE.md).
