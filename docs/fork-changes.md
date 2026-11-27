# Fork changes

This page records the differences this fork maintains on `develop` and `main`, and the changes already incorporated upstream. [Upstream project](https://github.com/anidl/multi-downloader-nx) · [🛠️ Developer guide](DEVELOPMENT.md) · [Changelog](CHANGELOG.md)

## Active changes

### Nightly revision metadata

The root manifest stores the base version in `version`, the release channel in `fork.channel` and the revision number in `fork.revision`. The `fork.repository` and `fork.releaseTag` fields identify the release used for update checks. [package.json](../package.json)

The shared formatter combines those values as `<version> (<channel>) [Rev<number>]` for provider banners, GUI startup/version responses and the generated CLI reference. A service-qualified `--version` prints the base version. Fork update notices compare base versions first and use the revision number when those versions are equal. The build copies this metadata into `lib` and the release archives. [Shared formatter](../modules/module.fork-display.ts)

The fork revision is set manually. CI reads it from the target manifest. The publisher reads the manifest at the immutable target source SHA, validates it before any release mutation, and uses one `Nightly Fork (RevN)` title for draft creation and final publication. Never use the workflow-controller checkout’s metadata for a different target. Preserve the fixed `nightly-fork` tag/URL and asset names. A package metadata change requires fresh Tests and is outside the documentation/controller-only proof-reuse exception.

### Disable manual update requests on the fork

Keep `--update` recognized after a leading service so a manual request receives the fork-specific release location instead of invoking the upstream updater. The CLI exits with a nonzero status and prints this plain-text notice before authentication, provider, archive, or download actions:

```text
Updates disabled on this fork. Download updates: https://github.com/XxUnkn0wnxX/multi-downloader-nx/releases/tag/nightly-fork
```

This applies with `--dry-run` too. Derive the manual notice, CLI help and automatic notice destination from the same `fork.repository` and `fork.releaseTag` metadata. Preserve the existing refusal and nonzero exit.

### Fork update notices

Both source and packaged CLI startup use the [fork notifier](../modules/module.fork-update.ts) before archive or episode processing. Keep the existing `--skipUpdate`, `skipUpdate: true`, preview and status guards; the code default for `skipUpdate` remains `false`. One batch invokes the check once. Preserve upstream’s updater implementation in [module.updater.ts](../modules/module.updater.ts), but route on the presence of fork metadata before its packaged-build guard. Invalid fork metadata or a failed check must never fall through to upstream’s updater.

Query the configured published rolling release, require its immutable source commit and eight uploaded CLI archive/checksum pairs, then read `package.json` at that commit. The main-only release workflow publishes after successful builds; neither mutable `main` metadata nor the release title determines the available version. The installed CLI already carries its version and revision; an embedded local commit is unnecessary. A newer base version qualifies even if its revision is lower. At equal semantic version precedence, only a higher revision qualifies; an older base version never wins through a higher revision. Same-version, same-revision rebuilds do not create an update notice.

Print one two-line notice with one tab before `Download updates:` and the configured Nightly link. Fetch only public release/package metadata: never download update payloads, install changes or replace application files. Successful checks use a 24-hour cache in the `fork` entry of `config/updates.json`, bound to installed version/revision and repository/tag; preserve unrelated legacy cache fields. A cached newer result may print once at the next startup without an HTTP request. Use one five-second deadline across both metadata requests and body reads. Lookup and cache-persistence failures are nonfatal, with diagnostics restricted to debug mode; a cache write failure must not suppress a validated notice. Replace the cache atomically and exclude `updates.json.*.tmp` from Git and build copies.

### Ignore local files and generated output

Preserve the categorized `##` sections in [.gitignore](../.gitignore) and its coverage of dependency/build directories, local configuration and credentials, runtime state, downloaded media, Android analysis artifacts, `.tmp/`, and `tmp/`. Local audit records and downloaded APK/DEX files must remain untracked. Keep root `.tmp/` excluded in ESLint too: its flat configuration does not automatically apply `.gitignore`.

Keep the intended exceptions for environment examples, the tracked GUI `.env` defaults, and `.gitkeep` placeholders. Ordinary source files and shared configuration defaults must remain visible to Git.

An upstream replacement must retain these exclusions and intended exceptions; verify representative private/build paths and source/default paths with `git check-ignore --no-index` before removing overlapping rules.

### Apply .gitignore during the build copy

[tsc.ts](../tsc.ts) applies its existing build-specific exclusions first, then the repository root `.gitignore` when collecting files for `lib`.

- Keep both filters. A `.gitignore` exception must not override an existing build exclusion; overlapping rules do not need a separate de-duplication pass.
- Use the `ignore` parser, declared as a development dependency in [package.json](../package.json) and resolved in [pnpm-lock.yaml](../pnpm-lock.yaml). It handles comments, including `##` headers, wildcards, and `!` exceptions.
- Match normalized repository-relative paths and mark directories with a trailing slash so directory-only rules work.
- Exclude the complete root `tools/` tree from the application copy, including tracked maintenance source and its local work. Preserve similarly named application paths outside that directory.
- Ship the full `docs/` tree, including screenshots, and the public [CDM setup guide](../widevine/README.md) in release archives. Only the guide belongs in the packaged `widevine/` folder. The packaged `playready/` folder is empty.
- Preserve the explicit GUI bundle copy. Keep required runtime defaults and the root package/workspace configuration available to the generated application.

The current filter reads the root `.gitignore`; it does not load nested ignore files, global Git excludes, or `.git/info/exclude`. Private build exclusions must therefore be covered by the root file or the existing build filter.

Before accepting an upstream replacement, check headers, directory rules, wildcards, negated examples, retained defaults, and the precedence of existing build exclusions. Git ignoring a file does not by itself prevent a builder from copying it.

### Keep transitive esbuild compatible with macOS Big Sur

Upstream already pins the direct root `esbuild` dependency to `0.26.0`. The fork also enforces that version through both workspace overrides:

- [pnpm-workspace.yaml](../pnpm-workspace.yaml)
- [gui/react/pnpm-workspace.yaml](../gui/react/pnpm-workspace.yaml)

```yaml
overrides:
    esbuild: 0.26.0
```

Keep the corresponding [root lockfile](../pnpm-lock.yaml) and [GUI lockfile](../gui/react/pnpm-lock.yaml) consistent. This covers transitive copies used by `tsx` and `@yao-pkg/pkg`, as applicable. The builder copies the root manifest and workspace configuration into `lib` before installing its dependencies; preserve that propagation.

Newer transitive esbuild binaries caused `_SecTrustCopyCertificateChain` loader failures on Big Sur despite the direct pin. See upstream [issue #1303](https://github.com/anidl/multi-downloader-nx/issues/1303). Do not remove the overrides merely because the direct dependency is pinned.

Keep `esbuild` at `0.26.0` throughout this fork, including root, GUI, and generated `lib` dependencies. Do not replace or advance this pin during upstream merges or dependency updates. Check both lockfiles, resolved transitive versions, and native esbuild/tsx execution on Big Sur. The fork's initial checks passed for frozen lockfiles and native esbuild/tsx smoke tests; a full GUI build was not validated at that time.

### Pin patched proxy and shell quoting dependencies

The root and GUI workspace overrides pin transitive `proxy-addr` to `2.0.8` for [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h). The GUI override also pins `shell-quote` to `1.11.0` for [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv). Express and `launch-editor` already allow these patched versions, so their direct dependency versions remain unchanged. Keep both lockfiles consistent with the overrides. Remove an override only after verifying that the relevant dependency chain resolves to a patched version without it.

### Accept Crunchyroll cookies exports for `--token`

The CLI opens global help with no arguments or with `--help` alone. Use `--debug` alone or with global `--help` to show the local version and platform. For service commands, put `--service crunchy`, `--service hidive` or `--service adn` first and specify the service only once. Global help lists shared options. Each service’s help adds its own options. Crunchyroll device and cookie sign-in appear in `--service crunchy --help`. Once Crunchyroll is selected, its sign-in notices show which options to replace in the current command. Complete examples use `anidl` for source runs and from outside the executable’s folder. On HIDIVE and ADN, `--auth` still prompts for a username or email and password.

On Crunchyroll, `--auth` redirects the user to device or cookie sign-in. Bare `--device` and `--token` **(Crunchyroll only)** after the service show their own help. Keep these notices ahead of provider startup and session writes. A second service marker or an invalid token setting must fail before an archive or download action. An explicitly selected login method takes precedence over a saved token default. [User sign-in guide](AUTHENTICATION.md#crunchyroll)

`--token` **(Crunchyroll only)** accepts the Crunchyroll `etp_rt` UUID value directly or a path to a file containing that value or a Netscape cookies export. File names and extensions are unrestricted. Only the existing Crunchyroll web-token request is used; authentication reports failure unless both the profile and CMS token requests succeed. Keep the existing cookie-based authentication and refresh behavior. See the [browser cookie input formats](CRUNCHYROLL-AUTH.md#browser-cookie-inputs).

### Log in to Crunchyroll with a device code

`--device androidtv` **(Crunchyroll only)** opens the activation page in the browser, prints the same link and the user code, waits for approval, and saves an Android TV session after profile/CMS validation. With `--dry-run`, it requests a device code and reports its initial expiry, then cancels automatically before opening the browser or polling for approval. It does not exchange a token or change the saved session; code validity after cancellation is not checked. New logins use `ANDROIDTV (xxxx)`, where `xxxx` is the last four characters of the device UUID. Preserve that UUID, name, `auth_type: device`, User-Agent and issuer across refreshes. Failed login must retain the previous session; transient refresh failures must keep saved credentials and stop affected work. See the [TV approval and validation steps](CRUNCHYROLL-AUTH.md#android-tv-approval).

Use the main authentication endpoint first with one warned beta fallback for eligible failures. Pin polling to the issuer and preserve configured proxy routing. Full request diagnostics remain available with `--debug`.

`--device android` **(Crunchyroll only)** opens the Android phone browser sign-in, prints the same URL for manual use, and accepts the full official callback in a hidden Terminal prompt. With `--dry-run`, it builds the URL and shows the paste instructions, then cancels automatically before opening a browser or accepting input. It does not exchange a token or change the saved session. Require the expected HTTPS origin, callback path and one matching state before exchanging the code. Supply phone OAuth client credentials through the CLI environment or the owner-only `config/cr_phone_client.env` file. Preserve the existing GUI flows, other services' auth and browser-cookie `--token` inputs. Device login does not guarantee CBR or an 8,000 kb/s video. See the [Android phone callback structure](CRUNCHYROLL-AUTH.md#android-phone-callback).

Store Android TV, Android phone and web sessions in separate blocks in `config/cr_token.yml`. Migrate flat files when saving, preserving the previous login. Write owner-only files atomically and serialize refreshes per session type. A refresh updates only its own block. The `--vstream` and `--astream` options **(Crunchyroll only)** select the session used for each endpoint through discovery and final playback. Require the same account for mixed requests and keep each playback token bound to its original session and content ID.

### Prefer HTTP/2 for provider requests

The [shared request client](../modules/module.fetch.ts) prefers HTTP/2 for all provider requests, including authentication, playback, manifests, and media segments. Apply the same preference when connecting to a destination through a configured proxy. Keep HTTP/1.1 available through TLS negotiation for destinations that only support it. HTTP/1.1 requests to the Crunchyroll Android phone playback gateway repeatedly hit Cloudflare challenges. The same saved session successfully acquired playback and retrieved its manifest over HTTP/2.

### Crunchyroll subtitle roles and subtitle-only output

Keep Crunchyroll's caption collection separate from normal subtitles. The `--CC` option **(Crunchyroll only)** defaults to true; accept `--CC true`, `--CC false`, their equals forms, and bare `--CC` as true, with effective CLI/config/archive precedence. False filters provider-identified captions before fetching subtitle URLs while retaining requested regular subtitles and signs. `ccTag` only controls caption labels and filenames. Do not infer caption identity from a custom label or subtitle text.

Compare known normalized provider audio/subtitle locales when classifying signs; a shared short language code alone is insufficient, such as US and India English both using `eng`. Preserve requested-audio subtitle context independently of selected video, and preserve role-aware deduplication. Exact locale matching retains the existing same-locale signs convention; it is not proof of subtitle content where the provider supplies no verified role metadata.

When VTT is converted to ASS, update both the displayed filename and actual filesystem path before writing. `noASSConv` retains VTT as the final output. Successful normal `novids` plus `noaudio` runs clean only recorded chapter intermediates unless `nocleanup`; retain finished subtitles, unrelated files and explicit skipmux/failure behavior. Never run general merger cleanup on subtitle-only output or delete files by extension globs.

### Discover available Crunchyroll legacy qualities

Before quality discovery or playback-session work, validate every selected audio version against the episode version metadata. Selected item languages take precedence over stale configured defaults, including GUI selections. Crunchyroll season `-s`, series `--srz` and GUI selections share multi-audio language filtering. Retain the original explicit `dubLang` list and require every requested language before starting that episode; `--allDubs` selects the dubs actually available for each episode and limits video comparison to that found audio-language pool, independently for every episode in a batch. It does not require missing configured or expected languages. Missing-dub diagnostics list every unavailable requested language by full name in one line, omitting available languages and duplicates. Season `-s` expands the available episode versions without changing episode/special numbering, filters, archive identity or unrelated-season requests. Preserve original explicit CLI input for complete diagnostics when direct episode-ID or `--extid` **(Crunchyroll only)** selections fail, while retaining those modes’ first-dub behavior. Keep HIDIVE selection and downloads unchanged. Normalize `dubLang` space/comma/mixed separators and validate the effective CLI/config/archive tag list before provider requests; list all invalid tags together, retain canonical codes, and preserve valid CLI override precedence. A missing selected version or unusable version identifier must fail before any video download; apply this to every dub and to previews and audio-only requests. Preserve the legacy path when version metadata is absent. With `--noaudio`, allow an available video version and retain subtitle/chapter processing without reporting a missing-audio error.

By default, discover current and usable legacy video for exactly the audio languages selected for the episode. Adding a selected language adds its video sources; English-only selection uses English video sources without automatically adding Japanese. Retain every distinct variant within the active scope. `--qall` **(Crunchyroll only)** expands the catalogue to all available languages. `-q 0` selects the highest compatible candidate in the active catalogue, ranked by resolution and then advertised bandwidth; explicit numbers select entries from that catalogue. Preserve each entry's segments, initialization and DRM metadata, its own playback context, and independent CDN selection. Keep requested audio/subtitle/sign metadata separate; select the highest current audio independently of video quality numbers. Legacy availability depends on the episode, dub, and stream; retain current qualities when optional manifests are absent or unusable.

Mark the selected quality row. A fallback prints only the previous selection as `<-- Discarded`, when present, and its confirmed replacement as `<-- Re-selected`, retaining their numbers without repeating the full list.

The default compact view uses this limited language catalogue and shows its three highest resolution groups, up to four Current and four Legacy entries per group, ranked by advertised bandwidth across legacy families. Keep distinct source entries even when their bandwidths match, using catalogue order as the deterministic tie-break. Keep the selected entry visible even outside those groups or below the four displayed choices; retain unknown-height entries. Display the original numbers from the active catalogue, allowing compact-view gaps without renumbering. `--qall` (also `-qall`) or `qall: true` in `config/cli-defaults.yml` switches to all available languages and shows every eligible entry; the default is `false`. Because this changes the catalogue, quality numbers may differ between modes. Apply both catalogue scopes to global discovery and requested-version DASH/HLS lists. Display filtering does not reduce discovery requests.

Use decimal `kb/s` (1,000 bits/s) for quality-list bitrates, replacing the old `KiB/s` label and binary divisor. `KiB/s` means 1,024 bytes/s; transfer-speed statistics retain their own byte-based units. Keep advertised manifest bandwidth distinct from measured file-average bitrate.

The [manifest helper](../modules/module.crunchy-manifests.ts) checks only the recognized clean-video paths, keeps the original origin and query, and limits optional requests. Missing legacy manifests stay silent normally; `--debug` retains full candidate/request diagnostics. Keep normal fallback notices short, naming the video language and timing drift, unknown timing, or other concise cause; do not print one for each rejected candidate. Keep hardsub selection intact and skip unnecessary probes when video is not needed. The GUI accepts listed Crunchyroll quality numbers without an artificial 99-entry limit.

Compact lists omit the hidden-quality count and its `--qall` footer: default discovery cannot count additional qualities in unqueried languages.

The [catalog and timing defaults](../modules/module.crunchy-video-catalog.ts) keep discovery limits and timing tolerances together with explicit units. Compare declared video timelines within the active language scope, not subtitle cues; `--qall` enables the broader language comparison. Matching declarations do not prove decoded synchronization or identical edits. Keep required audio languages separate from optional video-source languages, so Japanese video cannot substitute for missing English audio. Multi-dub uses the same discovery/pacing logic as `--qall` with its selected-language pool; it retains the compact display unless `--qall` is enabled. Single-dub selection uses normal batch pacing. Global selection is limited to supported raw DASH; preserve requested-version behavior for hardsubs, keep-all-video mode and unsupported metadata. Reacquire the chosen representation before execution, retain its own lease, and aggregate the independent video/audio passes before muxing or recording completion.

The [discovery scheduler](../modules/module.crunchy-discovery-scheduler.ts) retains normal single-dub batches of eight application requests, random nominal 250–400 ms gaps, response-time credit, and scaling to cap deliberate automatic waiting at six seconds. Multi-dub discovery and `--qall` instead sample a fresh integer 700–1100 ms pause before every non-cleanup discovery request, including the first, without response-time credit or that six-second cap. Keep both sets of maintainer defaults centralized in the [catalog defaults](../modules/module.crunchy-video-catalog.ts). The all-language scan remains slower and sends more requests that can trigger limits affecting normal viewing.

An explicit timer set with `--discovery-timmer`, `-disctmr` or `--disctmr` **(Crunchyroll only)**, or with the `discovery-timmer` or `disctmr` config key, replaces automatic pacing exactly, including zero: per batch for a single dub and per request for multi-dub or `--qall` discovery. Canonical config keys take precedence over aliases, including false or zero. Cleanup of owned sessions bypasses pacing, and overlapping recovery/pacing requirements use the longer wait without double-counting admitted recovery sleep. Other auth, media, license, subtitle, status and standalone flows are not globally throttled.

Single-dub active work remains bounded to 90 seconds; multi-dub and `--qall` get 180 seconds, preserving the same scheduler window through preflight and replay. Separately credited playback-recovery sleeps retain their own bounds. HTTP 429 manifests retain the nominal 1/5/20-second cooldown schedule, smaller batches of 4/2/1, retry gaps and the 45-second rate-wait budget. Playback and manifest recovery share the retry counter and escalation. Each request, including its body, retains its 15-second bound. A deadline or required wait that cannot fit is terminal after owned cleanup, even if some time remains; never escape through a fresh fallback scheduler. These client settings do not establish a provider rate limit or guarantee avoidance of 429 responses.

Playback/download session acquisitions remain single-attempt except for the exact bounded playback-recovery case described below; never replay an uncertain acquisition or cleanup. Release owned sessions promptly, including late-returned tokens. Cancellation, exhausted recovery and uncertain cleanup stop execution. Keep existing media segment concurrency (`partsize`), media retries and subtitle fetching unchanged.

The CLI uses one transient discovery row. After 90 seconds of multi-dub or `--qall` active work, a safe scheduler checkpoint changes the discovery label to `Discovering all qualities is taking extra time`. Keep that state through temporary retry, clearing and slot-wait messages, without replacing an active recovery phase or adding a second timer/row. Plain/debug output receives at most one extra-time notice; suppress animation for debug, GUI and non-interactive terminals. Clear the row before output and restore the cursor on completion or cancellation. Warn once per command for `--qall`, `--allDubs` (regardless of available language count), or more than two explicitly selected dub languages. Use "Full stream discovery" for `--qall` and "Multi-stream discovery" for the other cases; combined options use the full-stream warning only. Preserve conditional TSD notices without duplication.

The `--bypasssync` flag **(Crunchyroll only)** and `bypasssync` config key are the timing overrides for selected-language multi-dub and `--qall` selection; `false` disables the override. They bypass video/audio timing checks and may cause desynchronization. `--noaudio` still makes checks that require audio unnecessary. Keep authorization, stream availability, recovery and cleanup guards intact; the override changes timing eligibility only. Normal `--force` file-exists behavior is separate. Preserve original timing without automatic trimming, stretching or guessed offsets.

The manifest transformation was identified in [Yurasubs' pinned implementation](https://github.com/Yurasubs/multi-downloader-nx/blob/ea46829974f78a8bcb8b5b5e07a3185ab6fb4916/crunchy.ts#L1558) and corroborated by [erolus77's implementation](https://github.com/erolus77/multi-downloader-nx-dots/blob/f35bebe26af0494dc679c5f66821f33b507a7304/crunchy.ts#L1551). Additional playback research included [Croptix](https://github.com/stratumadev/croptix/issues/13) and [pcela's legacy-endpoint fallback](https://github.com/pcela/multi-downloader-nx/blob/ca99d707cd013d06eb426234c79deadb0d0be952/crunchy.ts#L1762); those approaches are not copied into this implementation. Preserve this provenance when adapting upstream changes.

### Explicit Crunchyroll playback-session reset

With episode selection, `--tsd` **(Crunchyroll only)** or `tsd: true` assesses capacity before every episode, including a single episode and previews; without it, do not make proactive session checks. Clear only a validated full session snapshot when the shared command-wide allowance remains unused. Await every planned DELETE and confirmed success, then obtain a fresh complete count before any acquisition. Episode recovery accepts `active < API-derived account limit`, including nonzero counts and account limits other than four. Failed/uncertain deletion or unknown/still-full final verification stops; no early continuation while clearing and no new post-clear polling loop. Standalone explicit CLI `--tsd` still force-clears the listed sessions and requires verified zero, including with `--dry-run` or `--debug`; config alone never triggers it.

Exact fully received HTTP 429/provider 4294 acquisition refusals permit bounded recovery after owned-session cleanup. Preserve TSD-off behavior and ordinary 10/30/60-second retries when enabled TSD has not intervened. An actual clear/verification or full-capacity slot recovery owns only its complete related acquisition group; the same unresolved problem must not fall back to ordinary tiers or escape through another acquisition path. TSD preflight ownership prepares only the next group. Use at most two TSD retries within remaining cumulative/shared/post-reset limits, and require a newly verified recovery event or admissible explicit `Retry-After` for each replay. Free/unknown snapshots alone grant no replay. Complete-group success releases ownership and resets local display numbering, without replenishing any allowance; later independent downstream work keeps its existing policy.

Keep one account-wide clear per command, five-second polling under one 60-second slot deadline, the 120-second playback-sleep allowance, request bounds, and active-work windows of 90 seconds normally or 180 seconds with qall. TSD-owned preflight polling must stop if available capacity cannot be verified. Check impossible server waits after owned cleanup but before TSD clearing/polling, and recheck before replay using the original refusal timestamp. Manifest recovery retains its own wait policy/budget and the shared retry counter. Do not present available capacity as a reservation or a guaranteed rate-limit bypass. See [Crunchyroll playback recovery](CRUNCHYROLL-RECOVERY.md) for operator behavior and limits.

### Read-only Crunchyroll playback status

`aniDL --service crunchy --check-status` **(Crunchyroll only)** is a CLI-only read action that accepts optional `--debug`. It requires an existing saved login and performs the normal token refresh first; the subsequent capacity snapshot has a 15-second deadline. It does not acquire playback or delete sessions. Report known allowance, active sessions and calculated available slots, preserving partial known values when another lookup fails; incomplete data is unknown, not zero. Return failure after a partial snapshot if a lookup fails. Report status-API HTTP/`Retry-After` observations separately from the account-bound historical playback wait record. That local informational record is best effort and does not control recovery. Neither available capacity nor an elapsed historical wait proves playback is currently allowed. See [Crunchyroll playback recovery](CRUNCHYROLL-RECOVERY.md).

### Preview downloads without media output

`--dry-run` is a CLI or programmatic action and is not enabled by configuration. It lists available and selected stream information for Crunchyroll, HIDIVE and ADN, then stops before license requests, media/subtitle/font downloads, chapter output, decryption, muxing and completed-download archive writes. Keep outer provider completion guards and cleanup of only the preview's own playback sessions, except for a capacity-based reset enabled by `--tsd` **(Crunchyroll only)** or `tsd: true`, including previews. The standalone font command lists planned URLs in preview mode.

Preview mode skips automatic updates. An explicit `--update` request prints the fork notice above and exits; archive-add actions remain rejected. Existing authentication/refresh, metadata requests and HEAD checks, logging and GUI queue progression can still occur; this is a download preview. `--debug` remains available. Normal download behavior and prerequisites must be preserved.

### Crunchyroll mux flags and track order

Apply the Crunchyroll policy in the shared merger only when explicitly supplied by Crunchyroll. Set Default=yes on every included video, audio and subtitle track. Force only Signs; closed captions take precedence over an overlapping signs marker and must never be forced. Explicitly clear inherited Forced flags on other tracks. Support both MKVToolNix MKV and FFmpeg MKV/MP4 output. Keep `defaultAudio` and `defaultSub` accepted but superseded by this policy for Crunchyroll; preserve their existing behavior for other providers.

Use the actual selected episode languages, including GUI selections, for explicit `dubLang` audio order. For `allDubs`, order available English, Japanese, then the other languages alphabetically by `LanguageItem.name` (English names), with normalized locale and original position as stable ties. Preserve distinct regional locales even when they share an ISO code. Retain existing source filenames and timing identity separately from mux ordering identity.

Build the final output map after existing timing analysis, independently of acquisition/input order: retained video(s), all ordered audio, then subtitle language groups in audio order, each Signs → full → CC. Put additional subtitle-only languages afterward in deterministic language/locale order. Preserve selected video, calculated delays, `keepAllVideos`, `skipSubMux` sidecars and chapter/font handling. Carry split-versus-combined input layout so a DASH video-only download does not require a nonexistent audio stream. Combined HLS inputs use the same final mux policy; their download/decryption/resume and timing stages remain unchanged.

### Preserve inputs when muxing fails

The shared merger reports whether its command succeeded and produced a new or updated nonempty output; MKVToolNix exit 1 remains success with warnings when that output exists. Crunchyroll, HIDIVE and ADN must propagate hard failure before cleaning mux inputs or recording completed downloads. A missing muxer, interrupted execution, fatal exit, missing/empty output or unchanged stale output must retain those inputs. Keep intentional `skipmux`, no-video/subtitle-only and `skipMuxOnSubFail` outcomes separate from hard failures, and retain unmuxed `skipSubMux` subtitle sidecars.

Preserve `nocleanup` for successful operations too, including existing retention of encrypted download inputs. This does not change download/decryption sequencing, HLS processing, partial-download resume state, overwrite handling or removal of internal temporary duplicates. Do not describe failure retention as a new automatic recovery system.

### Use undetermined language for video tracks

Both MKVToolNix and FFmpeg set video-track language metadata to `und`. Preserve descriptive video titles, including source-language names and `[Simulcast]` / `[Uncut]` labels. Audio and subtitle tracks retain their own language tags.

### Fork CI and Nightly builds

The fork uses two workflows. Tests checks the CLI on Node 22 and 24, validates the generated CLI reference and skips pushes or pull requests limited to Markdown, `docs/` or `tools/`. The upstream Docker and automatic documentation publishing workflows were removed. [Tests workflow](../.github/workflows/test.yml)

Nightly Fork publishes eight CLI archives with SHA-256 files at the fixed `nightly-fork` tag. Publication requires a current `main` target and passing Tests for its source inputs. Release notes distinguish the built commit from the tested commit when an eligible manual run reuses a passing ancestor. The macOS CLI packages use Node 22 for Big Sur. [Nightly Fork workflow](../.github/workflows/release-matrix.yml) · [Release and verification steps](DEVELOPMENT.md#publish-a-nightly-release)

### CLI documentation

The [documentation generator](../modules/build-docs.ts) writes only the [CLI reference](ARGUMENTS.md). It lists each option once, with shared options in the main list and Crunchyroll-only options in a separate disclosure. The hand-written guides use relative links and package their CLI screenshots under `docs/imgs/cli/` for offline viewing. [Updating the docs](DEVELOPMENT.md#update-the-cli-docs)

## Already incorporated upstream

The Android TV client credentials and User-Agent update from fork commit 78ea053 match upstream commit [8599faa](https://github.com/anidl/multi-downloader-nx/commit/8599faab539a878bcfb57a6fc07eac27dab1f873). The auth module has no remaining fork difference after that upstream merge. Follow upstream for subsequent auth changes; do not preserve the old credential values as a permanent fork requirement.
