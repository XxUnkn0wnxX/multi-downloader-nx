# Fork changes to preserve

This fork follows [anidl/multi-downloader-nx](https://github.com/anidl/multi-downloader-nx). Keep the changes below on `develop` until upstream supplies equivalent behavior. An upstream version bump alone does not replace a workaround: compare the actual implementation and dependency resolutions before removing it.

**Browse:** [README](README.md) · [Getting started](GET-STARTED.md) · [CLI reference](DOCUMENTATION.md) · [Issues](../../../issues)

## Branch boundaries

| Branch | Pull source | Push destination | Purpose |
| --- | --- | --- | --- |
| `master-upstream` | `upstream/master` | `origin/master-upstream` | Exact upstream mirror; no fork commits. |
| `develop` | `origin/develop` | `origin/develop` | Fork changes and merges from `master-upstream`; fork default branch. |

These are the expected local tracking settings. Keep only these two maintenance branches on the fork's `origin`; fetching upstream branches does not require publishing them to the fork. Fast-forward `master-upstream` from upstream, then merge it into `develop`. Never merge `develop` into `master-upstream`.

The local `config.zsh` build wrapper selects `master-upstream` and runs its full build when called without arguments. To build local fork changes, explicitly select `develop`:

```sh
config.zsh --branch develop --local
```

`--local` skips remote synchronization and keeps local changes. By itself it keeps the current branch; `--branch` explicitly chooses one. Pulls on `master-upstream` use `upstream/master`, while pushes use `origin/master-upstream`.

[AGENTS.md](../AGENTS.md) and this guide are tracked maintenance files on `develop`; they must also stay out of the upstream mirror.

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

An upstream replacement must cover root, GUI, and generated `lib` dependencies. Check both lockfiles, resolved transitive versions, and native esbuild/tsx execution on Big Sur before replacing the compatibility approach. The fork's initial checks passed for frozen lockfiles and native esbuild/tsx smoke tests; a full GUI build was not validated.

### Accept Crunchyroll cookies exports for `--token`

On `develop`, `--token` accepts the Crunchyroll `etp_rt` UUID value directly or a path to a file containing that value or a Netscape cookies export. File names and extensions are unrestricted. Only the existing Crunchyroll web-token request is used; authentication reports failure unless both the profile and CMS token requests succeed. Keep the existing cookie-based authentication and refresh behavior.

### Log in to Crunchyroll with a device code

`--device` prints the activation URL and code, waits for approval, and saves an Android TV session after profile/CMS validation. New logins use `ANDROIDTV (xxxx)`, where `xxxx` is the last four characters of the device UUID. Preserve that UUID, name, `auth_type: device`, User-Agent and issuer across refreshes. Failed login must retain the previous session; transient refresh failures must keep saved credentials and stop affected work.

Keep HTTP/2 scoped to device auth, with the main endpoint first and one warned beta fallback for eligible failures. Pin polling to the issuer and preserve configured proxy routing and existing download transports. Full request diagnostics remain available with `--debug`.

Crunchyroll CLI `--auth`, `--username`, `--password` and `--silentAuth` direct users to `--device` before updates or login. Keep underlying GUI auth, other services' auth and legacy browser-cookie `--token` support. Device login does not guarantee CBR or an 8,000 kb/s video.

### Discover available Crunchyroll legacy qualities

Keep current and usable legacy video renditions in the same numbered quality list, including compatible provider-linked language versions. `-q 0` selects the highest resolution, then advertised bandwidth; explicit numbers select individual entries. Preserve each entry's segments, initialization and DRM metadata, its own playback context, and independent CDN selection. Keep requested audio/subtitle/sign metadata separate; select the highest current audio independently of video quality numbers. Legacy availability depends on the episode, dub, and stream; retain current qualities when optional manifests are absent or unusable.

The [manifest helper](../modules/module.crunchy-manifests.ts) checks only the recognized clean-video paths, keeps the original origin and query, and limits optional requests. Missing legacy manifests stay silent normally; `--debug` retains full candidate/request diagnostics. Keep normal fallback notices short, naming the video language and timing drift, unknown timing, or other concise cause; do not print one for each rejected candidate. Keep hardsub selection intact and skip unnecessary probes when video is not needed. The GUI accepts listed Crunchyroll quality numbers without an artificial 99-entry limit.

The [catalog and timing defaults](../modules/module.crunchy-video-catalog.ts) keep discovery limits and timing tolerances together with explicit units. Compare declared video timelines, not subtitle cues; matching declarations do not prove decoded synchronization or identical edits. Global selection is limited to supported raw DASH; preserve requested-version behavior for hardsubs, keep-all-video mode and unsupported metadata. Reacquire the chosen representation before execution, retain its own lease, and aggregate the independent video/audio passes before muxing or recording completion.

`--forcevideo` / `--forcevid` bypasses timing eligibility with a desync warning; `--noaudio` makes those checks unnecessary. Keep authorization, stream availability and request limits intact. Normal `--force` file-exists behavior is separate. Preserve original timing without automatic trimming, stretching or guessed offsets.

The manifest transformation was identified in [Yurasubs' pinned implementation](https://github.com/Yurasubs/multi-downloader-nx/blob/ea46829974f78a8bcb8b5b5e07a3185ab6fb4916/crunchy.ts#L1558) and corroborated by [erolus77's implementation](https://github.com/erolus77/multi-downloader-nx-dots/blob/f35bebe26af0494dc679c5f66821f33b507a7304/crunchy.ts#L1551). Additional playback research included [Croptix](https://github.com/stratumadev/croptix/issues/13) and [pcela's legacy-endpoint fallback](https://github.com/pcela/multi-downloader-nx/blob/ca99d707cd013d06eb426234c79deadb0d0be952/crunchy.ts#L1762); those approaches are not copied into this implementation. Preserve this provenance when adapting upstream changes.

### Preview downloads without media output

`--dry-run` lists available and selected stream information for Crunchyroll, HIDIVE and ADN, then stops before license requests, media/subtitle/font downloads, chapter output, decryption, muxing and completed-download archive writes. Keep outer provider completion guards and cleanup of only the preview's own playback sessions. The standalone font command lists planned URLs in preview mode.

Preview mode skips automatic updates and rejects explicit update/archive-add actions. Existing authentication/refresh, metadata requests and HEAD checks, logging and GUI queue progression can still occur; this is a download preview. `--debug` remains available. Normal download behavior and prerequisites must be preserved.

### Run development checks

The **Style and build test** workflow in [.github/workflows/test.yml](../.github/workflows/test.yml) runs on pushes and pull requests targeting `develop`, with manual dispatch available. Push/PR workflows skip changes limited to Markdown or `docs/`; mixed code/documentation changes still run. Keep the matching documentation exclusions in the Docker and auto-documentation push workflows; release events and manual dispatch remain available.

The test workflow first checks TypeScript without emitting files and runs `node tests/crunchy-token-input.mjs` for cookie input, device login, refresh, transport cancellation and GUI queue failure handling. Catalog, global-video, manifest and provider-preview fixtures plus generated-reference parity run once in that shared gate; ESLint, Prettier, and the existing platform packaging checks remain required downstream. Keep this branch-specific workflow adaptation separate from changes intended for the upstream mirror.

Keep lockfile-based pnpm download caches separate for root checks and builds that also install GUI dependencies. Cache only verified `pkg` runtime downloads, scoped to OS, architecture and build inputs; keep normal installs and tests on cache misses, and exclude generated applications and `node_modules`.

### Keep documentation links relative

Use relative links for repository files and supported GitHub project navigation, and named Markdown links for external resources. Keep upstream issue/commit provenance links pointed at upstream. The generator in [modules/build-docs.ts](../modules/build-docs.ts) must preserve this behavior and the reference text sourced from CLI option definitions; it writes only [DOCUMENTATION.md](DOCUMENTATION.md). The [README](README.md) and [getting-started guide](GET-STARTED.md) are maintained separately.

## Already incorporated upstream

The Android TV client credentials and User-Agent update from fork commit 78ea053 match upstream commit [8599faa](https://github.com/anidl/multi-downloader-nx/commit/8599faab539a878bcfb57a6fc07eac27dab1f873). The auth module has no remaining fork difference after that upstream merge. Follow upstream for subsequent auth changes; do not preserve the old credential values as a permanent fork requirement.

## Maintaining this guide

For each upstream integration, compare the remaining diff with these active changes. Preserve behavior even when upstream reorganizes the affected files. When upstream replaces a change, remove only redundant fork code after the relevant checks pass, then record the upstream commit and validation here. Keep unresolved compatibility work listed as active.
