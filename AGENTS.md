# Repository instructions

Read and follow [docs/fork-changes.md](docs/fork-changes.md) before changing this fork or integrating upstream updates. It defines the behavior that `develop` must retain and when an upstream implementation can replace a fork change.

- Keep fork code, this file, and `docs/fork-changes.md` tracked on `develop`.
- Keep `master` an exact upstream mirror: fast-forward it from `upstream/master`, then merge `master` into `develop`. Never merge fork changes back into `master`.
- Maintain only `master` and `develop` on the fork's `origin`; upstream feature and Dependabot branches do not need to be copied there.
- Preserve the active changes in the guide during merges and dependency updates. Retire a workaround only after verifying equivalent upstream behavior, and update the guide with that evidence.
- Keep local audit files, credentials, dependency directories, and generated outputs out of commits and generated application files as described in the guide.
