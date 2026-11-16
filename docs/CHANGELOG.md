# Fork changelog

Changes specific to this fork are grouped below with their implementation commits. See [Fork changes](fork-changes.md) for maintenance requirements and the [README](README.md) for usage.

## 2026-11-17

### Nightly Rev5: check requested audio before video discovery

- Reject missing selected audio versions before quality discovery or video download, for every dub, including previews and audio-only requests. Keep the GUI-selected language authoritative and preserve the legacy path when version metadata is absent.
- Require every explicitly requested `--dubLang` language before starting a multi-audio episode; let `--allDubs` download whatever dubs are available without failing for missing configured or expected languages. Preserve that distinction through CLI/config and GUI selection.
- Warn once for more than two explicitly selected dubs or any `--allDubs` request, using "Multi-stream discovery" wording. Keep the "Full stream discovery" warning for `--qall`, without duplication.
- Reuse the all-language discovery scheduler for multi-dub requests, including 700–1100 ms per-request pacing and explicit timer overrides, while retaining compact output and the selected-language source pool.
- Allow video-only downloads with `--noaudio` when the selected dub is unavailable, retaining subtitle and chapter processing without a misleading missing-language error.
- Build video comparison from exactly the selected audio languages, or from each episode’s available dubs with `--allDubs`; `--qall` overrides that scope to search all available languages. Keep requested audio independent of video selection and preserve timing checks, quality ranking and stable catalogue numbers.

## 2026-11-16

### Nightly Rev4: fork update notices

Implementation: [901f783](../../../commit/901f783802beeb057132d98c6d167f25576cc3c8).

- Notify source and packaged CLI users when the published Nightly release has a newer base version, or a higher revision at the same base version. Read the release’s immutable source metadata and preserve the fixed release URL.
- Honor `skipUpdate` and existing preview/status guards, check once before batches, and retain the daily successful-check cache. Fetch metadata only; preserve upstream’s updater code while preventing this fork from entering its installation path.
- Keep lookup failures nonfatal with a shared five-second request budget, and print the download link on a separate line indented by one tab.
- Remove the misleading hidden-quality footer from compact lists ([7259f2c](../../../commit/7259f2c0cf7f87e57ef6b732c50dc5752677a5d0)); preserve quality rows, selection markers and numbering.
- Focus the GitHub About description on CLI support while retaining the README’s GUI support statement.

### Nightly Rev3: discovery pacing and TSD recovery

Implementation: [f997444](../../../commit/f9974441993ea46106a1ec1329432c33967c6cbb).

- Pace every all-language discovery request with a fresh 600–999 ms delay. Keep normal selected-language batch pacing and exact fixed timer overrides, including zero, in both modes.
- Allow 180 seconds of active work for qall discovery and update the existing status row after 90 seconds. Stop after cleanup when discovery or its next required wait cannot fit the budget.
- Keep TSD recovery within the affected complete acquisition group, without ordinary retry-tier delays for the same unresolved problem or replenished shared limits. Finish the whole clear and fresh verification before resuming; episode recovery accepts capacity below the account’s API-derived limit, while standalone reset still requires zero.
- Store the Nightly revision alongside the base version in package metadata. Show it in provider/GUI displays and use the exact released source’s revision for the rolling release title. Keep raw CLI version output, the release tag, URLs and assets compatible.
- Update the recovery and getting-started guides, fork maintenance notes, CLI help and regenerated reference.

## 2026-11-15

### Normal Nightly release and visible build targets

Commit: [8d33e89](../../../commit/8d33e89abf389c4bc3442136e8f513022c4b3f6a).

- Keep the same Nightly Fork page and tag as a normal Latest release while replacing its CLI assets.
- Name each architecture job with its Windows, macOS, Linux, and Alpine targets, and expose four packaging steps while retaining shared setup and caching.

### Service overview and manual Nightly releases

Commits: [df5309f](../../../commit/df5309f182abaed4844db025f1426f7f1e92886d), [347250e](../../../commit/347250e4fde96e9d59d8eff60756002e60aba8aa).

- Reorganize the README around Crunchyroll, HIDIVE, and ADN, with shared setup, compact service details, and fewer command blocks.
- Add main-only manual Nightly builds that can reuse passing source tests across documentation-only descendants while publishing the current commit. Changed source, build, workflow, test, or dependency inputs still need fresh Tests.
- Keep built and tested revisions distinct in artifact provenance. Block newer failed or pending attempts, detect reruns during proof selection, and recheck source proof and main before final publication.

### Fork CLI builds and rolling release

Commit: [26657a9](../../../commit/26657a9ee8e24d160fadbf3118d949c4ff0e08e1).

- Separate Tests from packaging, covering develop/main pushes, pull requests, and manual runs. Run all tracked source suites on Node 22 and 24, with shared type, documentation, and style checks. Documentation-only pushes and pull requests are skipped.
- Build eight CLI archives on two hosts after the exact current main revision passes Tests, reusing each host's preparation and verified runtime cache. GUI packaging is excluded.
- Replace one Nightly Fork release, validating all archives, checksums, and build provenance. Preserve interrupted drafts for retry and finish uploads before advancing the final tag and notes.
- Use Node 22 in macOS CLI packages for the Big Sur baseline; keep Node 24 for other targets and GUI packaging. The macOS x64 executable passed a clean-environment help check on Big Sur; hosted builds and other platforms remain to be verified.

### Crunchyroll video discovery and download previews

Commit: [1f915c4](../../../commit/1f915c446ed74b5e7681aa61012350bb7a369bf8).

- Discover available legacy video renditions alongside current manifests, including compatible same-episode language versions. Keep requested current audio, subtitles, and signs independent of the video choice.
- Check declared video timing before cross-language selection, with concise fallback notices and a timing-only override (now named `--bypasssync`). Matching manifest timing does not guarantee identical edits or decoded synchronization.
- Add `--dry-run` previews for Crunchyroll, HIDIVE, and ADN, stopping before licenses, downloaded output, decryption, muxing, and completed-download history writes.
- Preserve bounded playback-session ownership and cleanup, full debug diagnostics, generated CLI documentation, and focused offline coverage. Legacy availability remains dependent on provider manifest families; this is not a guaranteed higher-bitrate fix.

Manifest research credits: [Yurasubs](https://github.com/Yurasubs/multi-downloader-nx/blob/ea46829974f78a8bcb8b5b5e07a3185ab6fb4916/crunchy.ts#L1558), [erolus77](https://github.com/erolus77/multi-downloader-nx-dots/blob/f35bebe26af0494dc679c5f66821f33b507a7304/crunchy.ts#L1551), [Croptix](https://github.com/stratumadev/croptix/issues/13), and [pcela](https://github.com/pcela/multi-downloader-nx/blob/ca99d707cd013d06eb426234c79deadb0d0be952/crunchy.ts#L1762).

### Crunchyroll quality display

Commits: [c262a81](../../../commit/c262a81b836ff94fe61458f0ab337739ab89ef60), [88554c8](../../../commit/88554c875b651566c1e179b896849e94ecc0679d), [8ac989e](../../../commit/8ac989ed797fa7b416f3da85192494a4b1a41109), [d752790](../../../commit/d7527906e893699bfdf1461d15c80ac04fa048b7), [69b3099](../../../commit/69b3099042d8c938aa151fbcaa709b124830e4fd).

- Group video choices by resolution, ordered by dimensions and advertised bitrate, with continuous numbering and compact indentation. Use decimal `kb/s` (1,000 bits/s), `[Current M]` / `[Legacy M]`, and `[V:lang]` video-source labels.
- Mark the actual selection; fallback prints only discarded and re-selected rows with their original numbers and a short reason.
- Give audio its own `[A:lang]` labels, selection marker, and nested server line, removing the duplicate selected-audio summary. Audio selection remains independent of video.
