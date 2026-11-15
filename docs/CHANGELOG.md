# Fork changelog

Changes specific to this fork are grouped below with their implementation commits. See [Fork changes](fork-changes.md) for maintenance requirements and the [README](README.md) for usage.

## 2026-11-15

### Crunchyroll video discovery and download previews

Commit: [1f915c4](../../../commit/1f915c446ed74b5e7681aa61012350bb7a369bf8).

- Discover available legacy video renditions alongside current manifests, including compatible same-episode language versions. Keep requested current audio, subtitles, and signs independent of the video choice.
- Check declared video timing before cross-language selection, with concise fallback notices and a timing-only `--forcevideo` override. Matching manifest timing does not guarantee identical edits or decoded synchronization.
- Add `--dry-run` previews for Crunchyroll, HIDIVE, and ADN, stopping before licenses, downloaded output, decryption, muxing, and completed-download history writes.
- Preserve bounded playback-session ownership and cleanup, full debug diagnostics, generated CLI documentation, and focused offline coverage. Legacy availability remains dependent on provider manifest families; this is not a guaranteed higher-bitrate fix.

Manifest research credits: [Yurasubs](https://github.com/Yurasubs/multi-downloader-nx/blob/ea46829974f78a8bcb8b5b5e07a3185ab6fb4916/crunchy.ts#L1558), [erolus77](https://github.com/erolus77/multi-downloader-nx-dots/blob/f35bebe26af0494dc679c5f66821f33b507a7304/crunchy.ts#L1551), [Croptix](https://github.com/stratumadev/croptix/issues/13), and [pcela](https://github.com/pcela/multi-downloader-nx/blob/ca99d707cd013d06eb426234c79deadb0d0be952/crunchy.ts#L1762).

### Crunchyroll quality display

Commits: [c262a81](../../../commit/c262a81b836ff94fe61458f0ab337739ab89ef60), [88554c8](../../../commit/88554c875b651566c1e179b896849e94ecc0679d), [8ac989e](../../../commit/8ac989ed797fa7b416f3da85192494a4b1a41109), [d752790](../../../commit/d7527906e893699bfdf1461d15c80ac04fa048b7), [69b3099](../../../commit/69b3099042d8c938aa151fbcaa709b124830e4fd).

- Group video choices by resolution, ordered by dimensions and advertised bitrate, with continuous numbering and compact indentation. Use decimal `kb/s` (1,000 bits/s), `[Current M]` / `[Legacy M]`, and `[V:lang]` video-source labels.
- Mark the actual selection; fallback prints only discarded and re-selected rows with their original numbers and a short reason.
- Give audio its own `[A:lang]` labels, selection marker, and nested server line, removing the duplicate selected-audio summary. Audio selection remains independent of video.
