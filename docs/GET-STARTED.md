# 🚀 Getting started with the AniDL CLI

[🏠 README](README.md) · [🔑 Sign in to a service](AUTHENTICATION.md) · [CLI reference](DOCUMENTATION.md)

Use this guide with **Nightly Rev7**. You’ll open AniDL, sign in to Crunchyroll and preview one episode before downloading it.

[💻 Open AniDL](#open-anidl) · [🔑 Choose your sign-in](#choose-your-sign-in) · [📥 Find and download an episode](#find-and-download-one-episode) · [🛠️ Troubleshooting](#troubleshooting)

## Open AniDL

1. Download a **CLI** archive for your operating system and processor from the [Nightly Fork release](../../../releases/tag/nightly-fork). For example, a typical Intel or AMD Windows PC uses `multi-downloader-nx-windows-x64-cli.7z`. On Linux, choose the matching `linux-x64` or `linux-arm64` CLI archive. On an ARM-based Windows PC, choose `windows-arm64`.
2. Extract the archive into a folder you can find again. Keep the included `config`, `videos`, `widevine` and `playready` folders beside the application.
3. Open a terminal in the extracted folder. On Windows, double-click `cmd-here.bat` to open Command Prompt there. On Linux, open your terminal and change to the extracted folder.
4. Run the command for your computer. You should see the Crunchyroll options.

<details>
<summary>🪟 Windows — Command Prompt</summary>

```bat
aniDL.exe --service crunchy --help
```

</details>

<details>
<summary>🐧 Linux — Terminal</summary>

```sh
./aniDL --service crunchy --help
```

</details>

To check the installed revision, look for `[Rev7]` in the startup banner, or run `aniDL.exe --debug` on Windows or `./aniDL --debug` on Linux. If you have an older revision, open the guide in the `docs/` folder that came with that archive.

Keep this terminal open for the commands below. If Windows cannot find `aniDL.exe` or Linux cannot find `./aniDL`, check that your terminal is open in the extracted folder. Linux may require making the executable runnable first with `chmod +x ./aniDL`.

These examples use the standalone CLI. If you built from source, use `node lib/index.js` from your checkout in place of `aniDL.exe` or `./aniDL`. See [Build from source](DEVELOPMENT.md#build-from-source).

## Choose your sign-in

The names Android TV, Android phone and browser cookie describe how AniDL connects to Crunchyroll. You run every command on your computer. The [sign-in guide](AUTHENTICATION.md) shows the full steps.

**Using the default settings?** Sign in with both Android TV and Android phone, using the same Crunchyroll account. AniDL uses the TV session for video and the phone session for audio.

| Your setup | Sign in | Video and audio options |
| --- | --- | --- |
| Default video and audio | [Android TV](AUTHENTICATION.md#android-tv) and [Android phone](AUTHENTICATION.md#android-phone-or-tablet) | No extra options needed |
| Android TV only | [Android TV](AUTHENTICATION.md#android-tv) | `--vstream androidtv --astream androidtv` |
| Android phone only | [Android phone](AUTHENTICATION.md#android-phone-or-tablet) | `--vstream android --astream android` |
| Browser cookie only | [Browser cookie](AUTHENTICATION.md#browser-cookie) | `--vstream chrome --astream chrome` |

`--vstream` chooses the video connection and `--astream` chooses the audio connection. The phone session also supports `androidtab`, and the browser cookie session also supports `firefox`. Available quality depends on the episode, account and service response.

🔄 **Already signed in with an older version?** Keep your existing `config/cr_token.yml` in the AniDL folder you use. AniDL can read the older file and updates its layout the next time it saves a login. A working web login can still be used for Chrome or Firefox streams. If AniDL asks for an Android TV or Android phone login, follow the matching sign-in guide. A browser cookie or cookies file goes with `--token`. Leave your saved AniDL session in `config/cr_token.yml`.

Once you have signed in, return here to find an episode.

## Find and download one episode

The following commands are for **Crunchyroll**. Run each command separately and wait for its result.

### Find the series

Search for a title. Replace `Spy x Family` with the series you want.

<details>
<summary>🪟 Windows — Command Prompt</summary>

```bat
aniDL.exe --service crunchy --search "Spy x Family"
```

</details>

<details>
<summary>🐧 Linux — Terminal</summary>

```sh
./aniDL --service crunchy --search "Spy x Family"
```

</details>

Find the series in the results. AniDL shows the series ID after `Z:` and lists its seasons beneath it. Copy the ID after `S:` for the season you want.

### List the episodes

Replace `SEASON_ID` with the season ID you copied. AniDL lists the episodes in that season.

<details>
<summary>🪟 Windows — Command Prompt</summary>

```bat
aniDL.exe --service crunchy -s SEASON_ID
```

</details>

<details>
<summary>🐧 Linux — Terminal</summary>

```sh
./aniDL --service crunchy -s SEASON_ID
```

</details>

AniDL prints “Episodes not selected!” after the list because this command only lists episodes. Note the episode selection number shown in the list. Replace `SEASON_ID` and `1` in the following commands with your own season ID and episode selection number.

### Preview the episode

Signed in with **both Android TV and Android phone**? Run the preview below. If you used just one method, go straight to the [single-login commands](#if-you-signed-in-with-one-method).

<details>
<summary>🪟 Windows — Command Prompt</summary>

```bat
aniDL.exe --service crunchy -s SEASON_ID -e 1 --dry-run
```

</details>

<details>
<summary>🐧 Linux — Terminal</summary>

```sh
./aniDL --service crunchy -s SEASON_ID -e 1 --dry-run
```

</details>

The preview contacts Crunchyroll and shows the available and selected streams. It stops before downloading media. Check that it identifies the episode and the video and audio you expect.

### Download the episode

First check the [download tools](#download-tools) and [CDM files](#cdm-files). Then run the same command without `--dry-run`.

<details>
<summary>🪟 Windows — Command Prompt</summary>

```bat
aniDL.exe --service crunchy -s SEASON_ID -e 1
```

</details>

<details>
<summary>🐧 Linux — Terminal</summary>

```sh
./aniDL --service crunchy -s SEASON_ID -e 1
```

</details>

By default, AniDL writes downloads to the `videos` folder beside the application. To choose dubs, subtitles and quality, see [Crunchyroll streams and quality](#crunchyroll-streams-and-quality) and the [CLI reference](DOCUMENTATION.md).

### If you signed in with one method

Choose the method you signed in with. Replace `SEASON_ID` and the episode number in each command. Run **Preview** first. Once the episode, video and audio look right, check the [download tools](#download-tools) and run **Download**. The download goes to `videos/` by default.

<details>
<summary>🪟 Windows — Command Prompt</summary>

**Android TV only** · Preview

```bat
aniDL.exe --service crunchy -s SEASON_ID -e 1 --vstream androidtv --astream androidtv --dry-run
```

Download

```bat
aniDL.exe --service crunchy -s SEASON_ID -e 1 --vstream androidtv --astream androidtv
```

**Android phone only** · Preview

```bat
aniDL.exe --service crunchy -s SEASON_ID -e 1 --vstream android --astream android --dry-run
```

Download

```bat
aniDL.exe --service crunchy -s SEASON_ID -e 1 --vstream android --astream android
```

**Browser cookie only** · Preview

```bat
aniDL.exe --service crunchy -s SEASON_ID -e 1 --vstream chrome --astream chrome --dry-run
```

Download

```bat
aniDL.exe --service crunchy -s SEASON_ID -e 1 --vstream chrome --astream chrome
```

</details>

<details>
<summary>🐧 Linux — Terminal</summary>

**Android TV only** · Preview

```sh
./aniDL --service crunchy -s SEASON_ID -e 1 --vstream androidtv --astream androidtv --dry-run
```

Download

```sh
./aniDL --service crunchy -s SEASON_ID -e 1 --vstream androidtv --astream androidtv
```

**Android phone only** · Preview

```sh
./aniDL --service crunchy -s SEASON_ID -e 1 --vstream android --astream android --dry-run
```

Download

```sh
./aniDL --service crunchy -s SEASON_ID -e 1 --vstream android --astream android
```

**Browser cookie only** · Preview

```sh
./aniDL --service crunchy -s SEASON_ID -e 1 --vstream chrome --astream chrome --dry-run
```

Download

```sh
./aniDL --service crunchy -s SEASON_ID -e 1 --vstream chrome --astream chrome
```

</details>

### Troubleshooting

- **AniDL asks for an Android TV or Android phone login.** Follow the named method in the [sign-in guide](AUTHENTICATION.md), using the same account for both default streams. Then repeat your original command.
- **The Android phone command asks for client settings.** Follow the prerequisite steps in [Android phone sign-in](AUTHENTICATION.md#android-phone-or-tablet), then run the phone command again.
- **The Android TV code expired.** Run the Android TV command again and use the new code.
- **The browser cookie file cannot be read.** Check the filename and path, then follow [Browser cookie](AUTHENTICATION.md#browser-cookie) to provide the file or cookie value again.
- **Your selected dub is unavailable.** Choose an available audio language using `--dubLang` or use `--allDubs` for the dubs available for each episode. Both options apply to Crunchyroll selections.

A valid saved login is reused across episodes and dubs. For playback capacity and retry information, see [Crunchyroll playback recovery](CRUNCHYROLL-RECOVERY.md).

## Download tools

For a normal download and mux, install [FFmpeg](https://www.videohelp.com/software/ffmpeg) and [MKVToolNix](https://www.videohelp.com/software/MKVToolNix). DRM decryption also needs either [Bento4 (`mp4decrypt`)](https://www.bento4.com/downloads/) or [Shaka Packager](https://github.com/stratumadev/shaka-packager/releases). These tools are separate from AniDL.

Add the folders containing the tools to your system path, or set their locations in `config/bin-path.yml`. Open a new terminal and check the commands you installed.

```text
ffmpeg -version
mkvmerge --version
mp4decrypt --help
```

If you use Shaka Packager, check its command in place of `mp4decrypt`. The exact executable names depend on your system and the tools you installed.

## CDM files

The application does not include CDM files. Supported Widevine inputs are a `.wvd` file, or a `client_id.bin` and `private_key.pem` pair. It also accepts the pair named `device_client_id_blob` and `device_private_key`. Supported PlayReady inputs are a `.prd` file, or `bgroupcert.dat` and `zgpriv.dat`; supported security levels are SL2000 and SL3000.

Place Widevine files in `widevine/` or PlayReady files in `playready/`, beside the application. See the [CLI reference](DOCUMENTATION.md) for additional settings.

## Set defaults and output paths

Edit `config/cli-defaults.yml` to save options for later commands. The [CLI reference](DOCUMENTATION.md) lists the settings and their defaults. For example, choose an audio endpoint and dub languages:

```yaml
astream: "android"
dubLang: ["jpn", "eng"]
```

To change where AniDL writes downloads, edit `content` in `config/dir-path.yml`. The default is `./videos/`. Forward slashes work in Windows paths.

```yaml
content: D:/Plex/Anime/
fonts: ./fonts/
```

Use `skipUpdate: true` in the defaults or `--skipUpdate` on a command to disable its [startup update notice check](README.md#fork-update-notices). Save changes before running AniDL again.

## Crunchyroll CLI

[Sign in to Crunchyroll](AUTHENTICATION.md#crunchyroll) for the Android TV, Android phone and browser cookie walkthroughs. The same guide covers [HIDIVE and ADN](AUTHENTICATION.md#hidive-and-adn).

## Crunchyroll streams and quality

The video and audio endpoints are independent choices. Available renditions and access depend on the episode, account, and service response. Endpoint names do not guarantee a fixed bitrate or CBR. Choosing separate video and audio endpoints can require more than one playback session, subject to provider and account limits. For capacity checks, explicit session reset, and bounded retry behavior, see [Crunchyroll playback recovery](CRUNCHYROLL-RECOVERY.md).

Each `--vstream` or `--astream` endpoint uses the corresponding saved login.

| Endpoint | Sign in with |
| --- | --- |
| `androidtv` | `--device androidtv` |
| `android` and `androidtab` | `--device android` |
| `chrome` and `firefox` | `--token` |

Crunchyroll can use multiple saved sign-in types in the same command. The default combination, `--vstream androidtv --astream android`, uses the saved Android TV session for video and the saved Android phone session for audio. Both sessions must belong to the same Crunchyroll account. With a single phone login, choose `--vstream android --astream android`. Availability can differ across endpoints.

If a selected endpoint has no valid session, the CLI names the affected stream and tells you which sign-in option to use. If both endpoints need a login, it reports each one.

The `--qall` option is available for Crunchyroll only.

For raw DASH, the numbered quality list can include compatible video from `[Current M]` and `[Legacy M]` sources, with the video source language shown as `[V:eng]` or `[V:jpn]`. By default, discovery covers exactly the selected audio languages. English-only selection uses English video sources; select both English and Japanese to compare both. All available variants within that scope remain eligible. `--qall` expands the catalogue to all available languages. Resolution headings group the list without resetting quality numbers. `-q 0` selects the compatible candidate with the highest resolution, then advertised bandwidth, in the active catalogue; its choice can differ with `--qall`. The highest current audio rendition is selected independently for each requested dub.

When episode version metadata is available, a missing selected audio language stops the episode before quality discovery or video download. This applies to English, Japanese and other dubs, including audio-only downloads and previews. For Crunchyroll multi-audio downloads, use either `-s SEASON_ID` or `--srz SERIES_ID` with an explicit list such as `--dubLang eng jpn hin`: every requested language must be available for the episode before it starts.

Spaces, commas and mixtures are accepted, including `--dubLang eng,jpn,hin` and `--dubLang eng, jpn hin`. Use the documented tags, such as `hin` for Hindi. Invalid tags from the command or effective configuration are listed together and rejected before provider requests; a valid CLI list overrides the configured list. Missing-dub errors list the unavailable languages by full name, such as `English, Hindi`, without including available dubs.

`--allDubs` works with either Crunchyroll selector and downloads the dubs found for each episode, even if a configured or expected dub is missing. For example, Japanese can download when English is unavailable. It builds the video comparison pool independently for each episode from those found audio languages, using the same multi-audio pacing and compact display. Direct episode-ID and `--extid` downloads retain their single-dub behavior. Use `--noaudio` for video without requiring the selected dub; it does not change your requested subtitle languages.

With `qall` unset or false, the compact list shows the three highest resolution groups (usually 480p, 720p and 1080p), up to four Current and four Legacy entries in each group, ranked by advertised bandwidth. Distinct source entries remain separate even when their advertised bandwidths match. The selected entry stays visible even outside those groups or below those choices. Hidden rows leave gaps in the active catalogue's numbers, but compact filtering does not renumber entries. Add `--qall` (or `-qall`) to use the all-language catalogue and show its full list, or set the matching config option:

```yaml
qall: true
```

Set `qall: false` to restore the compact default described above; `--qall=false` overrides a true config value for one run. Switching `qall` changes the active catalogue, so quality numbers may change. The four-row-per-family display limit does not reduce manifest requests within the active language scope. Multi-audio discovery compares the selected languages using the same scan and pacing logic as `--qall`, but keeps this compact display. Adding a language adds its manifest candidates; it does not add unselected languages. Single-dub requests keep normal batch pacing.

A once-per-command discovery warning appears with `--allDubs` or more than two explicitly selected dubs. It starts with "Multi-stream discovery"; `--qall` uses "Full stream discovery" instead. Combined options print only one warning.

Discovery pacing depends on the selected language scope:

| Mode | Default pacing | Active-work allowance |
| --- | --- | --- |
| Single selected dub | Sequential batches of eight application requests; nominal random 250–400 ms gaps with response-time credit and a six-second total added-wait cap. | 90 seconds |
| Multiple selected dubs or `--qall` | A fresh random 700–1100 ms pause before each discovery request, including the first; no response-time credit or six-second pacing cap. | 180 seconds |

An explicit `--disctmr`, `-disctmr`, or `--discovery-timmer` sets an exact fixed pause instead: per batch for a single dub, per request for multiple selected dubs or `--qall`. The `discovery-timmer` and `disctmr` config keys do the same; the canonical key wins when both are present, including zero. Zero disables this pacing, while request deadlines and rate-limit recovery still apply. Fixed pauses can exceed the automatic six-second normal-mode budget. The all-language scan sends more requests and can trigger limits that affect normal viewing.

During video-quality discovery, the CLI uses one transient status row. For multiple selected dubs or `--qall`, its discovery text becomes “Discovering all qualities is taking extra time” once 90 seconds of active work have elapsed, checked between requests. Retry, clearing and slot-wait messages temporarily take priority, then the extra-time text returns. Debug and non-interactive output receive at most one plain extra-time notice.

A rate-limited manifest follows the existing 1, 5 and 20-second cooldown schedule, smaller retry batches, and a 45-second rate-wait budget. Playback and manifest recovery share the scheduler’s retry count; the server’s `Retry-After` can require a longer wait. Separately bounded playback-recovery sleeps can extend the active-work window. Owned-session cleanup runs without a pacing delay, and overlapping pacing/recovery waits use the longer applicable requirement. A discovery timeout or a required pause that cannot fit stops the operation after cleanup. See [Crunchyroll playback recovery](CRUNCHYROLL-RECOVERY.md) for the TSD rules. `partsize` controls concurrent media segment downloads and does not control discovery pacing.

The audio quality list uses `[A:eng]` or `[A:jpn]` for the audio language, marks its selected row, and shows the audio server below it. These display changes apply to Crunchyroll.

Quality-list rates use decimal `kb/s` (1 kb/s = 1,000 bits/s). `KiB/s` measures 1,024 bytes/s.

Video timing checks compare declared timelines within the active language scope, including across multiple selected dubs; `--qall` retains checks across its broader catalogue. Matching timelines do not prove decoded synchronization or identical edits. If a check fails or timing is unknown, selection falls back to the requested version. `--bypasssync` (or `bypasssync: true` in config) bypasses video/audio timing checks and can cause desynchronization; `bypasssync: false` disables the override. `--noaudio` still skips checks that require audio. Subtitle cue times are not used as a timing reference. No automatic trimming, stretching, or offset is applied.

### Subtitles and captions

Crunchyroll includes matching closed captions by default. Use `--CC false` or `CC: false` in the config to skip tracks identified as captions while retaining your selected regular subtitles and signs. `--CC true` includes captions for one command even when the config disables them; `--CC=false` and `--CC=true` are also accepted. The `ccTag` setting changes only the caption label, such as `CC`; it does not select signs or control downloads.

Signs classification keeps regional subtitle locales separate from the selected audio locale. For example, sharing the `eng` code does not make an India-English subtitle a signs track for US-English audio. The provider's captions collection remains separate from normal subtitles.

For subtitles only, use `--novids --noaudio`. Converted VTT subtitles are saved with an `.ass` filename; `--noASSConv` retains VTT as the final output instead. After a successful normal subtitle-only run, generated chapter intermediates are cleaned up while finished subtitles remain. `--nocleanup` retains those intermediates; explicit `--skipmux` and failed operations retain their existing behavior. Cleanup does not delete unrelated files or arbitrary TXT/VTT files.

### Muxed track flags and order

Crunchyroll sets **Default=yes** on every included video, audio and subtitle track in MKV and MP4. Only Signs subtitles receive **Forced=yes**; full subtitles and closed captions are never forced. More than one language can have a forced Signs track. Player language preferences still determine which tracks play; the flags do not bind a particular subtitle track to an audio track.

Audio follows the selected `--dubLang` order: `--dubLang jpn,eng,hin` puts Japanese first, English second and Hindi third. With `--allDubs`, available English tracks come first, Japanese second, then other languages sorted by their English names. Regional variants remain separate and have a stable locale order.

The container holds the retained video track(s), then all audio tracks, then subtitles grouped in the audio language order. Each subtitle group is **Signs → full subtitles → CC**, including only downloaded tracks. Additional subtitle languages follow in a deterministic order. Choosing video from a different language does not move its audio to the front. `--noaudio` omits audio from the mux; `--novids` retains the existing separate audio/subtitle output behavior.

These mux rules also apply to combined HLS inputs without changing their download, decryption or timing stages. `defaultAudio` and `defaultSub` remain accepted settings, but Crunchyroll's automatic Default flags supersede them. Other providers retain their existing track metadata and ordering behavior.

### Keeping source files and retrying failures

Use `--nocleanup`, or `nocleanup: true` in the config, to keep the input video/audio tracks, subtitles and chapters after muxing. Encrypted download inputs are also retained where applicable. Decryption and muxing still run; temporary duplicates and completed-download resume markers can still be removed during processing.

Crunchyroll, HIDIVE and ADN clean mux inputs only after the muxer succeeds and produces a new or updated nonempty output. MKVToolNix's warning exit is accepted when it produces that output. Failed or interrupted muxes retain their inputs and are not recorded as completed downloads. Existing download retry/resume handling remains available; `--skipmux`, subtitle-only output and other intentional mux skips keep their existing behavior.

MKVToolNix replaces an existing final MKV at the same output path. FFmpeg normally prompts unless its options include `-y` (overwrite) or `-n` (refuse). Separately, existing downloaded source files use the downloader's rewrite/stop/continue prompt; `--force y`, `--force n` or `--force c` preselects that answer. This cleanup change preserves those existing overwrite and resume rules.

## Check Crunchyroll playback status

To see the current capacity and the latest recorded wait, open the command for your computer.

<details>
<summary>🪟 Windows — Command Prompt</summary>

```bat
aniDL.exe --service crunchy --check-status
```

</details>

<details>
<summary>🐧 Linux — Terminal</summary>

```sh
./aniDL --service crunchy --check-status
```

</details>

Only `--service crunchy` and optional `--debug` are accepted. The command requires an existing saved login and performs the usual token refresh first; that refresh may take additional time. The status snapshot is bounded to 15 seconds and does not start playback or clear sessions. Known capacity and available slots are shown even if another lookup fails; missing or incomplete values are unknown, not zero. A snapshot failure returns an error after any partial results are shown.

Status API `Retry-After` information is reported separately from the historical playback wait recorded after an earlier playback refusal. When active, the record includes its observation time, remaining wait and earliest suggested retry; an elapsed or missing record leaves current playback unverified. This command does not verify whether playback is currently allowed because it does not start playback. The local account-bound wait record is informational and best effort; it never changes recovery behavior. See [Crunchyroll playback recovery](CRUNCHYROLL-RECOVERY.md) for session recovery and its limits.

See the [CLI reference](DOCUMENTATION.md) for all options and the [README](README.md) for platform and source-build information.
