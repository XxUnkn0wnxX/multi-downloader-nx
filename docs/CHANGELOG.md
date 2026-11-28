# 📝 Fork changelog

Changes specific to this fork are grouped below with their implementation commits. See [Fork changes](fork-changes.md) for current differences, the [developer guide](DEVELOPMENT.md) for maintenance, or the [README](README.md) for usage.

## Unreleased

### Nightly Rev8 — Phone sign-in and subtitle fonts

- Android phone sign-in and refresh now use the settings bundled with AniDL. Run the same `--service crunchy --device android` command **(Crunchyroll only)**, complete sign-in in your browser, then paste the final address into the terminal. [Sign-in guide](AUTHENTICATION.md#android-phone-or-tablet) · [Phone settings change](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/35786611e712c0ecb1cf30dcea648abe268bcba7)
- If Crunchyroll or HIDIVE explicitly rejects a bundled app setting, AniDL names the setting a maintainer needs to update and keeps the saved login. [Warning guide](DEVELOPMENT.md#bundled-sign-in-settings) · [Sign-in diagnostics](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/ca1b2057285eb280f37f07c9045d005d06ba0470)
- The CLI archive now includes 31 subtitle fonts and their license notices in `fonts/`, replacing the loose `NotoSans-Regular.ttf` beside the executable. [Bundled fonts](../fonts/README.md) · [Font packaging change](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/dd108d5a77123aea17352b3e42e0a1adc8d845b3)
- When saving a Crunchyroll MKV, AniDL tries to fetch missing catalog fonts referenced by the selected ASS subtitles. It lists any unavailable fonts and continues muxing.

## 2026-11-28

### Nightly Rev7 — Crunchyroll CLI sign-in

| Previous Crunchyroll command | Command from Rev7 onward **(Crunchyroll only)** |
| --- | --- |
| `--service crunchy --device` for Android TV | `--service crunchy --device androidtv` |
| `--service crunchy --auth` for Android phone | `--service crunchy --device android` |
| `--service crunchy --token` with a cookie value or file | Keep using the same command and input. |

- Start each service command with one `--service` and its name. Bare `--help` opens general help. Bare `--device` and `--token` **(Crunchyroll only)** show examples after the service. HIDIVE and ADN still use `--auth` for username or email and password. [CLI routing](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/497e32af4bca05a08d919fd74b9199dbe49a9583)
- Add `--dry-run` to either Crunchyroll device sign-in to see the prompt. AniDL skips the browser and cancels automatically. Android TV requests a real code before cancelling. [Device sign-in previews](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/ec91cd8ec223e36ffbc4b53af3da99ecb2beb944)
- Reject a repeated service, an invalid saved Crunchyroll token setting, or a dry-run archive addition before taking action. [Validation changes](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/1198ac44bce0721c31ed0c5055365fb2659148c5)
- Follow the Windows, Linux or macOS walkthrough from sign-in through a first episode. [Getting started](GET-STARTED.md) · [Service sign-in guide](AUTHENTICATION.md)

### Download archive

HIDIVE now records completed episodes under their season and ADN under their show. Archive replay skips those episodes on the next run and prints a notice if the selected service has no entries. [Archive behavior](fork-changes.md#download-archive) · [Archive fix](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/590e954e45218603b2e2ce0c4b3e3455a906399c)

## 2026-11-26

### Nightly Rev6 — Crunchyroll phone sign-in and stream routing

Implemented in [54f0114](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/54f011470e4077ceabdee49ce0968817de301711) and [3ba3f15](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/3ba3f15f33465f3f4bbccde96aa7e85480b8387b).

- Re-enable `--auth` for Android phone browser sign-in. The CLI opens the sign-in page, prints the same link for manual use, and accepts the callback URL in a hidden prompt. [Rev6 phone sign-in instructions](https://github.com/XxUnkn0wnxX/multi-downloader-nx/blob/2e54450743e6d2c2c2f0477e9f1750ab67dffb4c/docs/GET-STARTED.md#crunchyroll-cli)
- Open the Android TV activation page automatically with `--device` **(Crunchyroll only)** and print the same link and activation code for manual use.
- Save phone, Android TV, and web sessions in separate blocks in `cr_token.yml`. Existing files migrate on save, and each refresh updates its own block. Keep `--device` activation and `--token` cookie input **(Crunchyroll only)** available.
- Use the saved session for the endpoint chosen by `--vstream` or `--astream` **(Crunchyroll only)**. Mixed video and audio routes require sessions from the same account. Discovery, manifests, and playback cleanup use the session that owns the request.
- Report which video or audio endpoint needs sign-in and show its matching command when the saved session is missing or rejected. [b0e6777](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/b0e6777f4b3e12c52700c638cf40b7ea6e43e081)
- Prefer HTTP/2 for direct and proxied provider requests after repeated HTTP/1.1 Cloudflare challenges on the Android phone playback gateway. Destinations can still negotiate HTTP/1.1. [e37f2b0](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/e37f2b08f7b67e9c2b225a1c12310e6b32fe4217)
- Restore segment downloads and combined video/audio muxing in the Crunchyroll HLS fallback after releasing the playback session. [90340f1](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/90340f19e35252fa272b6f5372afd11beff5b53b)

## 2026-11-17

### Nightly Rev5: audio selection, muxing and subtitle handling

- Set Default=yes on all included Crunchyroll video, audio and subtitle tracks, with Forced=yes only for Signs. Full subtitles and closed captions are never forced; other providers retain their existing track metadata policy.
- Order Crunchyroll audio by explicit `--dubLang` selection, or English → Japanese → other languages by English name with `--allDubs`. Place retained video first, all audio next, then each language's Signs → full subtitles → CC. Preserve regional variants and the selected video independently of audio order.
- Preserve mux inputs after failures or interrupted execution across Crunchyroll, HIDIVE and ADN, and prevent failed muxes from being recorded as completed downloads. Accept MKVToolNix warning exits only when a new or updated nonempty output exists.
- Preserve existing intentional skip behavior and `--nocleanup` retention. Keep download, decryption and legacy HLS processing order unchanged.
- Reject missing selected audio versions before quality discovery or video download, for every dub, including previews and audio-only requests. Keep the GUI-selected language authoritative and preserve the legacy path when version metadata is absent.
- Support multiple `--dubLang` selections and `--allDubs` with Crunchyroll `-s`, using the same per-episode multi-audio flow as `--srz` while preserving season episode selection. HIDIVE selection remains unchanged.
- Add `--CC true/false` **(Crunchyroll only)** and `CC` config control for captions, enabled by default; clarify that `ccTag` changes their label. Keep regional English subtitle locales distinct when classifying signs.
- Save VTT-to-ASS conversions with the correct `.ass` filesystem path. Clean recorded chapter intermediates after successful subtitle-only downloads unless `--nocleanup`, preserving final subtitle files and explicit skip/failure behavior.
- Report missing requested dubs together by full language name. Accept spaces, commas and mixed separators in `--dubLang`; reject invalid CLI/config language tags together before provider requests.
- Require every explicitly requested `--dubLang` language before starting a multi-audio episode; let `--allDubs` download whatever dubs are available without failing for missing configured or expected languages. Preserve that distinction through CLI/config and GUI selection.
- Warn once for more than two explicitly selected dubs or any `--allDubs` request, using "Multi-stream discovery" wording. Keep the "Full stream discovery" warning for `--qall` **(Crunchyroll only)**, without duplication.
- Reuse the all-language discovery scheduler for multi-dub requests, including 700–1100 ms per-request pacing and explicit timer overrides, while retaining compact output and the selected-language source pool.
- Allow video-only downloads with `--noaudio` when the selected dub is unavailable, retaining subtitle and chapter processing without a misleading missing-language error.
- Build video comparison from exactly the selected audio languages, or from each episode’s available dubs with `--allDubs`; `--qall` **(Crunchyroll only)** overrides that scope to search all available languages. Keep requested audio independent of video selection and preserve timing checks, quality ranking and stable catalogue numbers.

## 2026-11-16

### Nightly Rev4: fork update notices

Implementation: [901f783](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/901f783802beeb057132d98c6d167f25576cc3c8).

- Notify source and packaged CLI users when the published Nightly release has a newer base version, or a higher revision at the same base version. Read the release’s immutable source metadata and preserve the fixed release URL.
- Honor `skipUpdate` and existing preview/status guards, check once before batches, and retain the daily successful-check cache. Fetch metadata only; preserve upstream’s updater code while preventing this fork from entering its installation path.
- Keep lookup failures nonfatal with a shared five-second request budget, and print the download link on a separate line indented by one tab.
- Remove the misleading hidden-quality footer from compact lists ([7259f2c](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/7259f2c0cf7f87e57ef6b732c50dc5752677a5d0)); preserve quality rows, selection markers and numbering.
- Focus the GitHub About description on CLI support while retaining the README’s GUI support statement.

### Nightly Rev3: discovery pacing and TSD recovery

Implementation: [f997444](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/f9974441993ea46106a1ec1329432c33967c6cbb).

- Pace every all-language discovery request with a fresh 600–999 ms delay. Keep normal selected-language batch pacing and exact fixed timer overrides, including zero, in both modes.
- Allow 180 seconds of active work for `--qall` **(Crunchyroll only)** discovery and update the existing status row after 90 seconds. Stop after cleanup when discovery or its next required wait cannot fit the budget.
- Keep recovery with `--tsd` **(Crunchyroll only)** within the affected complete acquisition group, without ordinary retry-tier delays for the same unresolved problem or replenished shared limits. Finish the whole clear and fresh verification before resuming; episode recovery accepts capacity below the account’s API-derived limit, while standalone reset still requires zero.
- Store the Nightly revision alongside the base version in package metadata. Show it in provider/GUI displays and use the exact released source’s revision for the rolling release title. Keep raw CLI version output, the release tag, URLs and assets compatible.
- Update the recovery and getting-started guides, fork maintenance notes, CLI help and regenerated reference.

## 2026-11-15

### Normal Nightly release and visible build targets

Commit: [8d33e89](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/8d33e89abf389c4bc3442136e8f513022c4b3f6a).

- Keep the same Nightly Fork page and tag as a normal Latest release while replacing its CLI assets.
- Name each architecture job with its Windows, macOS, Linux, and Alpine targets, and expose four packaging steps while retaining shared setup and caching.

### Service overview and manual Nightly releases

Commits: [df5309f](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/df5309f182abaed4844db025f1426f7f1e92886d), [347250e](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/347250e4fde96e9d59d8eff60756002e60aba8aa).

- Reorganize the README around Crunchyroll, HIDIVE, and ADN, with shared setup, compact service details, and fewer command blocks.
- Add main-only manual Nightly builds that can reuse passing source tests across documentation-only descendants while publishing the current commit. Changed source, build, workflow, test, or dependency inputs still need fresh Tests.
- Keep built and tested revisions distinct in artifact provenance. Block newer failed or pending attempts, detect reruns during proof selection, and recheck source proof and main before final publication.

### Fork CLI builds and rolling release

Commit: [26657a9](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/26657a9ee8e24d160fadbf3118d949c4ff0e08e1).

- Separate Tests from packaging, covering develop/main pushes, pull requests, and manual runs. Run all tracked source suites on Node 22 and 24, with shared type, documentation, and style checks. Documentation-only pushes and pull requests are skipped.
- Build eight CLI archives on two hosts after the exact current main revision passes Tests, reusing each host's preparation and verified runtime cache. GUI packaging is excluded.
- Replace one Nightly Fork release, validating all archives, checksums, and build provenance. Preserve interrupted drafts for retry and finish uploads before advancing the final tag and notes.
- Use Node 22 in macOS CLI packages for the Big Sur baseline; keep Node 24 for other targets and GUI packaging. The macOS x64 executable passed a clean-environment help check on Big Sur; hosted builds and other platforms remain to be verified.

### Crunchyroll video discovery and download previews

Commit: [1f915c4](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/1f915c446ed74b5e7681aa61012350bb7a369bf8).

- Discover available legacy video renditions alongside current manifests, including compatible same-episode language versions. Keep requested current audio, subtitles, and signs independent of the video choice.
- Check declared video timing before cross-language selection, with concise fallback notices and a timing-only override, subsequently named `--bypasssync` **(Crunchyroll only)**. Matching manifest timing does not guarantee identical edits or decoded synchronization.
- Add `--dry-run` previews for Crunchyroll, HIDIVE, and ADN, stopping before licenses, downloaded output, decryption, muxing, and completed-download history writes.
- Preserve bounded playback-session ownership and cleanup, full debug diagnostics, generated CLI documentation, and focused offline coverage. Legacy availability remains dependent on provider manifest families; this is not a guaranteed higher-bitrate fix.

Manifest research credits: [Yurasubs](https://github.com/Yurasubs/multi-downloader-nx/blob/ea46829974f78a8bcb8b5b5e07a3185ab6fb4916/crunchy.ts#L1558), [erolus77](https://github.com/erolus77/multi-downloader-nx-dots/blob/f35bebe26af0494dc679c5f66821f33b507a7304/crunchy.ts#L1551), [Croptix](https://github.com/stratumadev/croptix/issues/13), and [pcela](https://github.com/pcela/multi-downloader-nx/blob/ca99d707cd013d06eb426234c79deadb0d0be952/crunchy.ts#L1762).

### Crunchyroll quality display

Commits: [c262a81](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/c262a81b836ff94fe61458f0ab337739ab89ef60), [88554c8](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/88554c875b651566c1e179b896849e94ecc0679d), [8ac989e](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/8ac989ed797fa7b416f3da85192494a4b1a41109), [d752790](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/d7527906e893699bfdf1461d15c80ac04fa048b7), [69b3099](https://github.com/XxUnkn0wnxX/multi-downloader-nx/commit/69b3099042d8c938aa151fbcaa709b124830e4fd).

- Group video choices by resolution, ordered by dimensions and advertised bitrate, with continuous numbering and compact indentation. Use decimal `kb/s` (1,000 bits/s), `[Current M]` / `[Legacy M]`, and `[V:lang]` video-source labels.
- Mark the actual selection; fallback prints only discarded and re-selected rows with their original numbers and a short reason.
- Give audio its own `[A:lang]` labels, selection marker, and nested server line, removing the duplicate selected-audio summary. Audio selection remains independent of video.

[Back to fork builds and releases](README.md#fork-builds-and-releases)
