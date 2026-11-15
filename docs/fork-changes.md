# Fork changes to preserve

This fork follows [anidl/multi-downloader-nx](https://github.com/anidl/multi-downloader-nx). Keep the changes below on `develop` until upstream supplies equivalent behavior. An upstream version bump alone does not replace a workaround: compare the actual implementation and dependency resolutions before removing it.

**Browse:** [README](README.md) · [Getting started](GET-STARTED.md) · [CLI reference](DOCUMENTATION.md) · [Issues](../../../issues)

## Branch boundaries

| Branch | Pull source | Push destination | Purpose |
| --- | --- | --- | --- |
| `master-upstream` | `upstream/master` | `origin/master-upstream` | Exact upstream mirror; no fork commits. |
| `develop` | `origin/develop` | `origin/develop` | Working fork changes and merges from `master-upstream`. |
| `main` | `origin/main` | `origin/main` | Stable fork and default branch; tested CLI releases. |

These are the expected local tracking settings. Keep these three maintenance branches on the fork's `origin`; fetching upstream branches does not require publishing them to the fork. Sync `master-upstream` from `upstream/master` and push it to `origin/master-upstream` as an independent mirror operation. This requires no adaptation or fork-integration plan. Never merge fork changes into `master-upstream`.

Promote reviewed `develop` revisions to `main` by fast-forward after Tests passes. The release workflow packages the current `main` revision with passing Tests for its source inputs. A manual release can reuse that proof across documentation-only descendants or changes limited to the release controller and its focused fixture, after local validation. Keep the upstream mirror free of fork changes.

[AGENTS.md](../AGENTS.md) and this guide are tracked maintenance files on the fork branches; they must stay out of the upstream mirror.

## Active changes

### Ignore local files and generated output

Preserve the categorized `##` sections in [.gitignore](../.gitignore) and its coverage of dependency/build directories, local configuration and credentials, runtime state, downloaded media, Android analysis artifacts, `.tmp/`, and `tmp/`. Local audit records and downloaded APK/DEX files must remain untracked.

Keep the intended exceptions for environment examples, the tracked GUI `.env` defaults, and `.gitkeep` placeholders. Ordinary source files and shared configuration defaults must remain visible to Git.

An upstream replacement must retain these exclusions and intended exceptions; verify representative private/build paths and source/default paths with `git check-ignore --no-index` before removing overlapping rules.

### Apply .gitignore during the build copy

[tsc.ts](../tsc.ts) applies its existing build-specific exclusions first, then the repository root `.gitignore` when collecting files for `lib`.

- Keep both filters. A `.gitignore` exception must not override an existing build exclusion; overlapping rules do not need a separate de-duplication pass.
- Use the `ignore` parser, declared as a development dependency in [package.json](../package.json) and resolved in [pnpm-lock.yaml](../pnpm-lock.yaml). It handles comments, including `##` headers, wildcards, and `!` exceptions.
- Match normalized repository-relative paths and mark directories with a trailing slash so directory-only rules work.
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

On `develop`, `--token` accepts the Crunchyroll `etp_rt` UUID value directly or a path to a file containing that value or a Netscape cookies export. File names and extensions are unrestricted. Only the existing Crunchyroll web-token request is used; authentication reports failure unless both the profile and CMS token requests succeed. Keep the existing cookie-based authentication and refresh behavior.

### Log in to Crunchyroll with a device code

`--device` prints the activation URL and code, waits for approval, and saves an Android TV session after profile/CMS validation. New logins use `ANDROIDTV (xxxx)`, where `xxxx` is the last four characters of the device UUID. Preserve that UUID, name, `auth_type: device`, User-Agent and issuer across refreshes. Failed login must retain the previous session; transient refresh failures must keep saved credentials and stop affected work.

Keep HTTP/2 scoped to device auth, with the main endpoint first and one warned beta fallback for eligible failures. Pin polling to the issuer and preserve configured proxy routing and existing download transports. Full request diagnostics remain available with `--debug`.

Crunchyroll CLI `--auth`, `--username`, `--password` and `--silentAuth` direct users to `--device` before updates or login. Keep underlying GUI auth, other services' auth and legacy browser-cookie `--token` support. Device login does not guarantee CBR or an 8,000 kb/s video.

### Discover available Crunchyroll legacy qualities

Keep current and usable legacy video renditions in the same numbered quality list, including compatible provider-linked language versions. `-q 0` selects the highest resolution, then advertised bandwidth; explicit numbers select individual entries. Preserve each entry's segments, initialization and DRM metadata, its own playback context, and independent CDN selection. Keep requested audio/subtitle/sign metadata separate; select the highest current audio independently of video quality numbers. Legacy availability depends on the episode, dub, and stream; retain current qualities when optional manifests are absent or unusable.

Mark the selected quality row. A fallback prints only the previous selection as `<-- Discarded`, when present, and its confirmed replacement as `<-- Re-selected`, retaining their numbers without repeating the full list.

The default compact view shows the three highest available resolution groups, up to four Current and four Legacy entries per group, ranked by advertised bandwidth across languages and legacy families. Keep distinct source entries even when their bandwidths match, using catalogue order as the deterministic tie-break. Keep the selected entry visible even outside those groups or below the four displayed choices; retain unknown-height entries. Display the original full-catalogue numbers, allowing gaps, without changing `-q N` or highest-quality selection. `--qall` (also `-qall`) or `qall: true` in `config/cli-defaults.yml` shows every eligible entry; the default is `false`. Apply this to global discovery and requested-version DASH/HLS lists. Display filtering does not reduce discovery requests.

Use decimal `kb/s` (1,000 bits/s) for quality-list bitrates, replacing the old `KiB/s` label and binary divisor. `KiB/s` means 1,024 bytes/s; transfer-speed statistics retain their own byte-based units. Keep advertised manifest bandwidth distinct from measured file-average bitrate.

The [manifest helper](../modules/module.crunchy-manifests.ts) checks only the recognized clean-video paths, keeps the original origin and query, and limits optional requests. Missing legacy manifests stay silent normally; `--debug` retains full candidate/request diagnostics. Keep normal fallback notices short, naming the video language and timing drift, unknown timing, or other concise cause; do not print one for each rejected candidate. Keep hardsub selection intact and skip unnecessary probes when video is not needed. The GUI accepts listed Crunchyroll quality numbers without an artificial 99-entry limit.

The [catalog and timing defaults](../modules/module.crunchy-video-catalog.ts) keep discovery limits and timing tolerances together with explicit units. Compare declared video timelines, not subtitle cues; matching declarations do not prove decoded synchronization or identical edits. Global selection is limited to supported raw DASH; preserve requested-version behavior for hardsubs, keep-all-video mode and unsupported metadata. Reacquire the chosen representation before execution, retain its own lease, and aggregate the independent video/audio passes before muxing or recording completion.

The [discovery scheduler](../modules/module.crunchy-discovery-scheduler.ts) preserves complete global discovery while pacing sequential requests in small batches. By default, normal eight-request batches use random 250–400 ms gaps, credit response time, and scale gaps to keep deliberately added normal waiting within six seconds. `--discovery-timmer` (also `-disctmr` or `--disctmr`) or the `discovery-timmer`/`disctmr` config key sets an exact additional pause in milliseconds between normal batches. Zero disables normal pauses; fixed pauses are not subject to the automatic six-second cap. Canonical config keys take precedence over aliases, including when the canonical value is false or zero. HTTP 429 manifest responses share three retries across the discovery, with minimum waits of 1, 5 and 20 seconds and smaller batches of 4, 2 and 1 requests. Honor a longer valid `Retry-After`; stop when it cannot fit the 45-second rate-wait budget or 90-second discovery deadline. Each request, including its body, retains its 15-second bound. These client settings do not establish a provider rate limit or guarantee avoidance of 429 responses.

Playback/download session acquisition and cleanup remain single-attempt operations; do not replay an uncertain acquisition. Release owned sessions promptly, including late-returned tokens, without waiting for a batch gap. Cancellation, exhausted rate recovery and uncertain cleanup stop execution instead of falling through to another discovery path. Keep existing media segment concurrency (`partsize`), media retries and subtitle fetching unchanged. The CLI shows a deferred `Discovering video qualities` indicator, switches to `Retrying video manifest (N/3 in Ns)` during each retry countdown, then returns to discovery status. It clears the indicator before output and restores the cursor on completion or cancellation; suppress animation for debug, GUI and non-interactive terminals.

`--forcevideo` / `--forcevid` bypasses timing eligibility with a desync warning; `--noaudio` makes those checks unnecessary. Keep authorization, stream availability and request limits intact. Normal `--force` file-exists behavior is separate. Preserve original timing without automatic trimming, stretching or guessed offsets.

The manifest transformation was identified in [Yurasubs' pinned implementation](https://github.com/Yurasubs/multi-downloader-nx/blob/ea46829974f78a8bcb8b5b5e07a3185ab6fb4916/crunchy.ts#L1558) and corroborated by [erolus77's implementation](https://github.com/erolus77/multi-downloader-nx-dots/blob/f35bebe26af0494dc679c5f66821f33b507a7304/crunchy.ts#L1551). Additional playback research included [Croptix](https://github.com/stratumadev/croptix/issues/13) and [pcela's legacy-endpoint fallback](https://github.com/pcela/multi-downloader-nx/blob/ca99d707cd013d06eb426234c79deadb0d0be952/crunchy.ts#L1762); those approaches are not copied into this implementation. Preserve this provenance when adapting upstream changes.

### Preview downloads without media output

`--dry-run` is a CLI or programmatic action and is not enabled by configuration. It lists available and selected stream information for Crunchyroll, HIDIVE and ADN, then stops before license requests, media/subtitle/font downloads, chapter output, decryption, muxing and completed-download archive writes. Keep outer provider completion guards and cleanup of only the preview's own playback sessions. The standalone font command lists planned URLs in preview mode.

Preview mode skips automatic updates and rejects explicit update/archive-add actions. Existing authentication/refresh, metadata requests and HEAD checks, logging and GUI queue progression can still occur; this is a download preview. `--debug` remains available. Normal download behavior and prerequisites must be preserved.

### Run development checks

The **Tests** workflow in [.github/workflows/test.yml](../.github/workflows/test.yml) runs on pushes and pull requests targeting `develop` and `main`, with manual dispatch available. Push/PR workflows skip changes limited to Markdown or `docs/`; mixed code/documentation changes still run.

Keep only Tests and the main-only Nightly Fork build/publish workflow. The inherited Docker and automatic documentation publishing workflows are removed. Regenerate the CLI reference locally with `pnpm run docs` and commit its output; Tests checks that the committed reference matches the generator without publishing documentation changes.

The Node 24 gate checks TypeScript without emitting files, all tracked `tests/*.mjs` suites, and generated-reference parity. A separate Node 22 job checks the same source suites for the macOS CLI runtime; ESLint and Prettier remain required. Tests run serially within each runtime job. Keep cookie/device/GUI, catalog, global-video, manifest, provider-preview, and release-contract coverage. Packaging belongs only in the release workflow.

### Package the tested stable CLI

The [Nightly Fork workflow](../.github/workflows/release-matrix.yml) listens for completed Tests runs on `main` and supports manual dispatch on `main`. Automatic releases retain their triggering Tests revision. A manual release may reuse the latest applicable successful main Tests result when its tested commit is an ancestor of the current target and the complete comparison contains only documentation, the release controller `.github/scripts/fork-release.mjs`, or its focused fixture `tests/fork-release.mjs`. Validate release-controller changes locally before this exception. Application source, dependencies, other tests, build tooling, and workflows require fresh passing Tests. An applicable newer failed or unfinished attempt blocks an older success.

Only this repository's expected Tests workflow, started by a main push or manual dispatch, qualifies. Preserve both the built target SHA and tested source SHA, Tests run ID and attempt, and current-main checks before preparation and publication. Check out the immutable target SHA, including its current docs; `workflow_run` uses the default branch for its controller. Reject ambiguous ancestry, incomplete comparison metadata, and history limits that prevent proof. Recheck applicable Tests before final publication. Only the gate and publisher need the additional `actions: read` permission for these metadata lookups.

Two hosts package CLI archives: Ubuntu x64 and macOS arm64. Each installs the frozen root lockfile and prepares CLI JavaScript once, then packages Windows, macOS, Linux static, and Alpine sequentially. Retain the existing eight archive names and their SHA-256 files, with no GUI preparation, duplicate source tests, or Docker publishing in this workflow. macOS CLI targets use Node 22 for Big Sur compatibility; other targets and existing GUI packaging retain Node 24. Local macOS x64 startup/help was verified on Big Sur with a clean environment; other target execution remains a platform check.

Keep lockfile-based pnpm download caches and normal installs. Cache only verified `pkg` `fetched-*` runtimes, scoped to host OS, architecture, target set, lockfile and build configuration; exclude applications and `node_modules`. The CLI runtime cache uses a new namespace so old single-target caches cannot mask the larger target set. Cache reuse also depends on GitHub branch scope.

The publisher validates all eight archives, eight checksums, and target/source/Tests/build provenance before removing the previous **Nightly Fork** release page. Keep the fixed `nightly-fork` tag name, serialized publication and stale-main checks. Delete the old release page, create a fresh draft with a new release ID, upload the sixteen assets, then recheck proof and current main before advancing the tag and publishing it as a normal Latest release. If upload fails, the new draft remains unpublished for diagnosis and a retry replaces that draft. Link concise notes to the [changelog](CHANGELOG.md) at the built target SHA and distinguish any reused tested source; do not generate a Full Changelog or commit source from the publisher. Host receipts retain their own build attempts so partial reruns can reuse a successful host's bundle. GitHub supplies the tag's source ZIP and tar archives separately from the sixteen uploaded asset files.

Release recreation is not atomic. A failed upload must fail the workflow visibly; the old page is already gone and the new draft stays unpublished. Retained build artifacts allow a complete rerun while that source is still current. GitHub can require workflow-write authority when the target commit's workflow files differ from the default branch; keep those definitions aligned during initial promotion and resolve any provider rejection explicitly, without adding credentials automatically.

### Keep documentation links relative

Use relative links for repository files and supported GitHub project navigation, and named Markdown links for external resources. Keep upstream issue/commit provenance links pointed at upstream. The generator in [modules/build-docs.ts](../modules/build-docs.ts) must preserve this behavior and the reference text sourced from CLI option definitions; it writes only [DOCUMENTATION.md](DOCUMENTATION.md). The [README](README.md) and [getting-started guide](GET-STARTED.md) are maintained separately.

## Already incorporated upstream

The Android TV client credentials and User-Agent update from fork commit 78ea053 match upstream commit [8599faa](https://github.com/anidl/multi-downloader-nx/commit/8599faab539a878bcfb57a6fc07eac27dab1f873). The auth module has no remaining fork difference after that upstream merge. Follow upstream for subsequent auth changes; do not preserve the old credential values as a permanent fork requirement.

## Maintaining this guide

Prepare a detailed plan before every review to integrate upstream changes into the custom fork branches and before merging or adapting those changes. The exact `master-upstream` mirror is exempt. Pin the fork baseline and upstream target, inventory the incoming changes, and map each to the active contracts above. Classify compatible changes for adoption, overlapping changes for careful adaptation, and unresolved conflicts for exclusion. Include dependency/shared-file ordering, affected providers and CLI/GUI behavior, Big Sur compatibility, validation, documentation, rollback, and required decisions.

Keep that plan and its acceptance evidence current through integration, then compare the final diff with these active changes. Preserve behavior even when upstream reorganizes files. When upstream replaces a change, remove only redundant fork code after equivalent behavior and the relevant checks are verified, then record the upstream commit and evidence here. Document what was adopted, adapted, excluded, or retired; keep unresolved compatibility work listed as active.
