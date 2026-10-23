# Fork changes to preserve

This fork follows [anidl/multi-downloader-nx](https://github.com/anidl/multi-downloader-nx). Keep the changes below on `develop` until upstream supplies equivalent behavior. An upstream version bump alone does not replace a workaround: compare the actual implementation and dependency resolutions before removing it.

## Branch boundaries

| Branch    | Pull source       | Push destination | Purpose                                                     |
| --------- | ----------------- | ---------------- | ----------------------------------------------------------- |
| `master`  | `upstream/master` | `origin/master`  | Exact upstream mirror; no fork commits.                     |
| `develop` | `origin/develop`  | `origin/develop` | Fork changes and merges from `master`; fork default branch. |

These are the expected local tracking settings. Keep only these two branches on the fork's `origin`; fetching upstream branches does not require publishing them to the fork. Fast-forward `master` from upstream, then merge it into `develop`. Never merge `develop` into `master`.

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

## Already incorporated upstream

The Android TV client credentials and User-Agent update from fork commit `78ea053` match upstream commit [`8599faa`](https://github.com/anidl/multi-downloader-nx/commit/8599faab539a878bcfb57a6fc07eac27dab1f873). The auth module has no remaining fork difference after that upstream merge. Follow upstream for subsequent auth changes; do not preserve the old credential values as a permanent fork requirement.

## Maintaining this guide

For each upstream integration, compare the remaining diff with these active changes. Preserve behavior even when upstream reorganizes the affected files. When upstream replaces a change, remove only redundant fork code after the relevant checks pass, then record the upstream commit and validation here. Keep unresolved compatibility work listed as active.
