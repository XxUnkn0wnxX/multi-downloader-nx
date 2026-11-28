# 🛠️ AniDL developer guide

Use this guide to build the CLI from source, check a change on `develop`, or publish the tested `main` revision. For the differences from upstream and why they matter, see [Fork changes](fork-changes.md). For a packaged CLI, start with [Getting started](GET-STARTED.md).

## Build from source

Install Node.js 22 or newer and pnpm 10 or newer. The following commands clone the fork’s working branch and open CLI help. [Node.js](https://nodejs.org/) · [pnpm](https://pnpm.io/)

```sh
git clone --branch develop https://github.com/XxUnkn0wnxX/multi-downloader-nx.git
cd multi-downloader-nx
pnpm install --frozen-lockfile
pnpm exec tsx index.ts --help
```

To compile and run the CLI locally, start from the repository root. **`pnpm run prebuild-cli` deletes and recreates `lib/`.** If you have settings, saved sign-ins, or downloads under `lib/`, copy them to a persistent folder before rebuilding. Keep the same `config/` and `videos/` subfolders.

```sh
pnpm run prebuild-cli
node lib/index.js --help
```

The compiled CLI defaults to `lib/config/` for settings and saved sign-ins and `lib/videos/` for downloads. Before signing in or downloading, set `contentDirectory` to the absolute path of a persistent folder outside `lib/`. Keep the variable set whenever you run the compiled CLI with that data.

- **Linux and macOS** — `export contentDirectory="$HOME/anidl-data"`
- **Windows Command Prompt** — `set "contentDirectory=%USERPROFILE%\anidl-data"`

The build stages [subtitle fonts](../fonts/README.md) in `lib/fonts/`. When using a persistent data folder, you can copy the bundled `fonts/` there or set `fonts` in `config/dir-path.yml` to the absolute path of your font collection.

Use `pnpm exec tsx index.ts` or `node lib/index.js` in place of `aniDL.exe` or `./aniDL` in the user guides. Keep the same service and options. Platform-specific packaging commands are listed in [package.json](../package.json).

## Check a change

Run the test that covers the behavior you changed. For Crunchyroll sign-in, the maintenance notes list the relevant tests and describe how to check the Android callback, Android TV approval and browser cookie formats. [Crunchyroll sign-in maintenance notes](CRUNCHYROLL-AUTH.md)

To check types, lint and formatting locally, run the same commands as CI.

```sh
pnpm exec tsc --noEmit
pnpm run eslint
pnpm run prettier
```

On pushes and pull requests targeting `develop` or `main`, **Tests** runs every tracked `tests/*.mjs` suite serially on both Node 22 and Node 24. Node 22 covers the runtime used by the macOS CLI. Node 24 also checks types, lint, formatting and the generated CLI reference. Automatic runs skip changes confined to Markdown, `docs/` or `tools/`. A change that also touches application code, dependencies, build configuration or workflows runs the usual checks. Tests for standalone maintenance utilities run locally. [Tests workflow](../.github/workflows/test.yml)

## Update the CLI docs

Edit the README, getting-started guide and sign-in guide directly. Link cropped CLI screenshots from `imgs/cli/` relative to the guide. Use relative links for repository files and keep upstream issue and commit links pointed at upstream.

The CLI reference is generated. Edit the option definitions or generator, then regenerate the reference from the repository root. [CLI options](../modules/module.args.ts) · [Documentation generator](../modules/build-docs.ts)

```sh
pnpm run docs
```

Review and stage the updated [CLI reference](ARGUMENTS.md) with its inputs. Run the generator again and check that the second run produces no further changes.

```sh
pnpm run docs
git diff --exit-code -- docs/ARGUMENTS.md
```

## Branches and upstream changes

| Branch on the fork | What belongs there |
| --- | --- |
| `develop` | Fork development, reviewed upstream adaptations and local test builds. |
| `main` | Stable default branch. Fast-forward it to a reviewed `develop` revision after Tests passes. |
| `master-upstream` | Exact mirror of `upstream/master`. Sync it independently and push it to `origin/master-upstream`. |

Each local branch tracks its namesake on `origin`. Keep these three branches on the fork. Other upstream branches can stay on the upstream remote. Syncing the exact mirror is a separate operation and needs no integration plan. The [fork changes](fork-changes.md) record is tracked on `develop` and `main`.

Use these steps when bringing upstream work into the fork.

1. Record the fork baseline and upstream target commits before the review. Compare the incoming changes with the active [fork changes](fork-changes.md), including dependency resolution and shared files.
2. Plan which changes to adopt, which need adaptation, and which to leave out until conflicts are resolved. Include affected providers, CLI and GUI paths, Big Sur compatibility, validation, docs, rollback and decisions that need review.
3. Check the final diff and record what was adopted, adapted, excluded or retired. When upstream replaces a fork change, verify equivalent behavior and dependency versions, then record the upstream commit and evidence before removing redundant fork code. Keep unresolved changes listed as active.

## Publish a Nightly release

Set `fork.revision` in the root manifest for the next fork revision. Keep that number through fixes and rebuilds on `develop` until it is promoted. Regenerate the CLI reference after changing the revision. A manifest change requires fresh Tests. [Revision metadata](fork-changes.md#nightly-revision-metadata)

Once **Tests** passes on the current `main` revision, **Nightly Fork** builds and publishes that revision automatically. To start a release manually in a fork you maintain, open **Actions → Nightly Fork → Run workflow**, choose `main`, then select **Run workflow**. [Nightly Fork workflow](../.github/workflows/release-matrix.yml)

**Which Tests run counts?** The workflow accepts a successful **Tests** run from a push or manual run on `main` in the same repository. A manual release can reuse a passing ancestor when the entire diff is limited to documentation, the release controller or its focused test. Validate controller changes locally first. Application code, dependencies, workflows, build tooling and other tests require fresh passing Tests. A newer applicable failure or unfinished run blocks release. [Release controller](../.github/scripts/fork-release.mjs) · [Release tests](../tests/fork-release.mjs)

**How do I verify the release?** Follow the x64 and arm64 build jobs, then the publisher. Open the **Latest** release at the fixed `nightly-fork` tag. Check the revision in the title, the built and tested commits in the notes, and the eight CLI archives with matching SHA-256 files under **Assets**. GitHub also supplies source archives. [Nightly Fork release](https://github.com/XxUnkn0wnxX/multi-downloader-nx/releases/tag/nightly-fork)

<details>
<summary>Build provenance, caching and publication recovery</summary>

- **Source selection.** The controller comes from the default branch. Each build checks out the exact target commit, including its docs. The workflow checks that it is still current before preparation and publication, and records both commits, the Tests run ID and attempt, and each host’s build attempt. It rejects incomplete comparison data or ambiguous ancestry and checks for newer applicable Tests before publishing. Only the gate and publisher need Actions read access for these lookups.
- **Build hosts.** Ubuntu builds x64 and macOS builds arm64. Each installs the frozen lockfile and prepares the CLI once, then packages Windows, macOS, Linux static and Alpine sequentially. The macOS CLI uses Node 22 for Big Sur and the other targets use Node 24. Local macOS x64 startup and help were verified on Big Sur. Other targets need their own runtime checks.
- **Caches.** The pnpm download cache is keyed by the lockfile. Only verified `pkg` runtimes matching `fetched-*` are cached, in a namespace scoped to host OS, architecture, target set, lockfile and build configuration. GitHub’s branch scope also affects reuse. The caches exclude applications and `node_modules`.
- **Publication.** The publisher validates the target manifest, provenance and all sixteen asset files before replacing the previous release with a fresh draft. After upload it rechecks Tests and current `main`, advances the fixed tag and marks the release **Latest**. The title uses the target’s fork revision. Notes link to the changelog at that commit and identify the tested source separately.
- **Failed publication.** Replacing the release page is a multi-step operation. If upload fails after the previous page was removed, the new draft stays unpublished. Rerun the workflow while the source is still current. The retry replaces the draft and can reuse retained build artifacts from a successful host. If GitHub rejects a tag update because workflow definitions differ from the default branch, review those definitions and the reported permissions before retrying.

</details>

<details>
<summary>⭐ TODO: Maintenance tools</summary>

Planned utilities in [`tools/`](../tools/) will help maintain Crunchyroll’s `basic_auth_token` and HIDIVE’s `hd_new_apiKey` / `hd_apikey` by:

- Downloading the latest suitable Crunchyroll or HIDIVE Android APK with `--dl`, or reusing one cached APK per service, then decompiling and extracting current app authentication tokens.
- Keeping ignored work folders and append-only token histories by app version/build, skipping identical entries.
- Providing `--help`, a shared Python environment, dedicated docs and local-only tests.

The folder, ignore rules and separation from application checks/builds are prepared; the scripts are not implemented yet.

</details>

[Back to the project README](README.md#build-from-source) · [Fork changes](fork-changes.md) · [Changelog](CHANGELOG.md)
