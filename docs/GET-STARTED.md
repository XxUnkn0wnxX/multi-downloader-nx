# 🚀 Getting started with the AniDL CLI

[🏠 README](README.md) · [🔑 Sign in to a service](AUTHENTICATION.md) · [CLI reference](ARGUMENTS.md)

You’ll open AniDL, sign in to Crunchyroll and preview one episode before downloading it.

[💻 Open AniDL](#open-anidl) · [🧰 Download tools](#download-tools) · [🔑 Choose your sign-in](#choose-your-sign-in) · [📥 Find and download an episode](#find-and-download-one-episode) · [🛠️ Troubleshooting](#troubleshooting)

## Open AniDL

1. Download the **CLI** archive for your computer from the [Nightly Fork release](https://github.com/XxUnkn0wnxX/multi-downloader-nx/releases/tag/nightly-fork). Look for a filename ending in `-cli.7z`.

   - **Windows** — Choose `windows-x64` for Intel or AMD, or `windows-arm64` for an ARM-based PC.
   - **Linux** — Choose `linux-x64` or `linux-arm64` to match your processor. For Alpine Linux, choose the matching `alpine` archive.
   - **macOS** — Choose `macos-arm64` for Apple silicon or `macos-x64` for Intel. You can check under **Apple menu → About This Mac**.

2. Extract the archive into a folder you can find again. Keep the folders together. The `docs/` folder contains the guides and screenshots for offline reading.
3. Open a terminal in the extracted folder. On Windows, double-click `cmd-here.bat` to open Command Prompt there. On Linux or macOS, open Terminal and use `cd` to change to the folder containing `aniDL`.
4. Choose the command for your computer. Windows Command Prompt uses `aniDL.exe`. On Linux and macOS, `./aniDL` runs the executable in the current folder. The command below lists the Crunchyroll options.

<details>
<summary>🪟 Windows — Command Prompt</summary>

```bat
aniDL.exe --service crunchy --help
```

</details>

<details>
<summary>💻 Linux and macOS — Terminal</summary>

```sh
./aniDL --service crunchy --help
```

</details>

The Crunchyroll sign-in commands in this guide work from Rev7 onward. To check your installed revision, look for the number after `Rev` in the startup banner, or run `aniDL.exe --debug` on Windows or `./aniDL --debug` on Linux and macOS. For earlier revisions, use the guide in the `docs/` folder that came with your archive.

Keep this terminal open for the commands below. If the command cannot be found, check that the terminal is in the folder containing the executable. If Linux or macOS reports “Permission denied,” run `chmod +x ./aniDL` and try again.

These examples use the standalone CLI. If you built from source, use `node lib/index.js` from your checkout in place of `aniDL.exe` or `./aniDL`. See [Build from source](DEVELOPMENT.md#build-from-source).

## Download tools

You can sign in and preview an episode before installing these tools. To save your first video, download the tools for your operating system and processor. For encrypted streams, you’ll also need your own [CDM device files](../widevine/README.md).

| Tool | What to download |
| --- | --- |
| [FFmpeg](https://ffmpeg.org/download.html) | Under **Get packages & executable files**, choose your platform. AniDL uses the `ffmpeg` program to combine tracks and write MP4 files. |
| [MKVToolNix](https://mkvtoolnix.download/downloads.html) | Choose Windows, macOS or your Linux distribution. The included `mkvmerge` program combines tracks into an MKV file. If you already have FFmpeg, AniDL can use that for MKV too. |
| [Shaka Packager](https://github.com/stratumadev/shaka-packager/releases) | For encrypted streams, open **Assets** and choose the `packager-` file for your platform (`win`, `linux` or `osx`) and processor (`x64` or `arm64`). Rename it to `shaka-packager.exe` on Windows or `shaka-packager` on Linux and macOS. |

**Where do the files go?** Extract the downloads and put the executables beside AniDL. If the FFmpeg archive has a `bin` folder, the `ffmpeg` executable is inside. Your Windows folder should look like this.

```text
AniDL/
├── aniDL.exe
├── ffmpeg.exe
├── mkvmerge.exe
├── shaka-packager.exe
└── config/
    └── bin-path.yml
```

On Linux and macOS, the layout is the same with the filenames `aniDL`, `ffmpeg`, `mkvmerge` and `shaka-packager`. A downloaded binary needs permission to run. For example, run `chmod +x ./shaka-packager` in the AniDL folder after renaming it. If a tool comes with DLLs or other libraries, keep its package together. You can point AniDL to the executable in that folder using the examples below.

**Do I need to set paths?** With the filenames above, the packaged CLI checks its own folder first. It then looks for each missing tool on your system’s `PATH`. If `ffmpeg -version` or `mkvmerge --version` works from another folder in a new terminal, you can leave that tool where it is.

<details>
<summary>My tools are in another folder or have different names</summary>

Open `config/bin-path.yml` inside the extracted AniDL folder. Change the entry for the tool you want to use. Give the path to its **executable file**, including the filename. A relative path starts from the folder containing AniDL. Here are two common examples.

| Example | Entry in `config/bin-path.yml` |
| --- | --- |
| Windows, MKVToolNix installed in Program Files | `mkvmerge: 'C:\Program Files\MKVToolNix\mkvmerge.exe'` |
| Linux, Shaka kept under its download name | `shaka: "tools/packager-linux-x64"` |

Use the path on your computer. For a full Windows path, keep the backslashes and single quotes shown above. If you already have `config/bin-path.user.yml`, edit that file instead. AniDL reads it in place of `bin-path.yml`.

</details>

Already using Bento4? Its `mp4decrypt` tool is an alternative to Shaka Packager for encrypted streams. The same placement rules apply. Use `mp4decrypt.exe` on Windows or `mp4decrypt` on Linux and macOS. Its config key is `mp4decrypt`. [Bento4 downloads](https://www.bento4.com/downloads/)

## Choose your sign-in

The names Android TV, Android phone and browser cookie describe how AniDL connects to Crunchyroll. You run every command on your computer. The [sign-in guide](AUTHENTICATION.md) shows the full steps.

**Using the default settings?** Sign in with both Android TV and Android phone, using the same Crunchyroll account. AniDL uses the TV session for video and the phone session for audio.

| Your setup | Sign in | Video and audio options **(Crunchyroll only)** |
| --- | --- | --- |
| Default video and audio | [Android TV](AUTHENTICATION.md#android-tv) and [Android phone](AUTHENTICATION.md#android-phone-or-tablet) | No extra options needed |
| Android TV only | [Android TV](AUTHENTICATION.md#android-tv) | `--vstream androidtv --astream androidtv` |
| Android phone only | [Android phone](AUTHENTICATION.md#android-phone-or-tablet) | `--vstream android --astream android` |
| Browser cookie only | [Browser cookie](AUTHENTICATION.md#browser-cookie) | `--vstream chrome --astream chrome` |

The phone session also supports `androidtab`, and the browser cookie session also supports `firefox`. Available quality depends on the episode, account and service response.

🔄 **Already signed in with an older version?** Keep your existing `config/cr_token.yml` in the AniDL folder you use. AniDL can read the older file and updates its layout the next time it saves a login. A working web login can still be used for Chrome or Firefox streams. If AniDL asks for an Android TV or Android phone login, follow the matching sign-in guide. A browser cookie or cookies file goes with `--token` **(Crunchyroll only)**. Leave your saved AniDL session in `config/cr_token.yml`.

Once you have signed in, return here to find an episode.

## Find and download one episode

The following examples use Crunchyroll. Run each command separately and wait for its result.

### Find the series

Search for a title. Replace `Spy x Family` with the series you want.

<details>
<summary>🪟 Windows — Command Prompt</summary>

```bat
aniDL.exe --service crunchy --search "Spy x Family"
```

</details>

<details>
<summary>💻 Linux and macOS — Terminal</summary>

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
<summary>💻 Linux and macOS — Terminal</summary>

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
<summary>💻 Linux and macOS — Terminal</summary>

```sh
./aniDL --service crunchy -s SEASON_ID -e 1 --dry-run
```

</details>

The preview contacts Crunchyroll and shows the available and selected streams. It stops before downloading media. Check that it identifies the episode and the video and audio you expect.

### Download the episode

First check the [download tools](#download-tools) and [CDM files](../widevine/README.md). Then run the same command without `--dry-run`.

<details>
<summary>🪟 Windows — Command Prompt</summary>

```bat
aniDL.exe --service crunchy -s SEASON_ID -e 1
```

</details>

<details>
<summary>💻 Linux and macOS — Terminal</summary>

```sh
./aniDL --service crunchy -s SEASON_ID -e 1
```

</details>

By default, AniDL writes downloads to the `videos` folder beside the application. To choose dubs, subtitles and quality, see [Crunchyroll streams and quality](#crunchyroll-streams-and-quality) and the [CLI reference](ARGUMENTS.md).

### If you signed in with one method

These examples use `--vstream` and `--astream` **(Crunchyroll only)**. Choose the method you signed in with. Replace `SEASON_ID` and the episode number in each command. Run **Preview** first. Once the episode, video and audio look right, check the [download tools](#download-tools) and run **Download**. The download goes to `videos/` by default.

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
<summary>💻 Linux and macOS — Terminal</summary>

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
- **The Android TV code expired.** Run the Android TV command again and use the new code.
- **The browser cookie file cannot be read.** Check the filename and path, then follow [Browser cookie](AUTHENTICATION.md#browser-cookie) to provide the file or cookie value again.
- **Your selected dub is unavailable.** Choose an available audio language using `--dubLang` or use `--allDubs` for the dubs available for each episode. Both options apply to Crunchyroll selections.

A valid saved login is reused across episodes and dubs. For playback capacity and retry information, see [Crunchyroll playback recovery](CRUNCHYROLL-RECOVERY.md).

## CDM files

For encrypted streams, place your device files in `widevine/` or `playready/` beside AniDL. The [CDM setup guide](../widevine/README.md) lists the accepted formats and filenames. In the extracted archive, open [`widevine/README.md`](../widevine/README.md).

## Set defaults and output paths

Edit `config/cli-defaults.yml` to save options for later commands. The [CLI reference](ARGUMENTS.md) lists the settings and their defaults. Use the `astream` setting **(Crunchyroll only)** to choose an audio endpoint. For example, you can set an endpoint and dub languages:

```yaml
astream: "android"
dubLang: ["jpn", "eng"]
```

To change where AniDL writes downloads, edit `content` in `config/dir-path.yml`. The default is `./videos/`. Forward slashes work in Windows paths.

```yaml
content: D:/Plex/Anime/
fonts: ./fonts/
```

The release includes [subtitle fonts](../fonts/README.md) in `fonts/`. When muxing a Crunchyroll MKV, AniDL automatically fetches missing fonts it recognizes from the selected subtitles. If a font is unavailable, AniDL names it in a warning and continues muxing. To download the full Crunchyroll font catalog in advance, use the [font download command](ARGUMENTS.md#--dlfonts).

Use `skipUpdate: true` in the defaults or `--skipUpdate` on a command to disable its [startup update notice check](README.md#fork-update-notices). Save changes before running AniDL again.

## Crunchyroll CLI

Follow the [sign-in guide](AUTHENTICATION.md#crunchyroll), then [preview one episode](#preview-the-episode) before changing the stream or language options below.

## Crunchyroll streams and quality

AniDL chooses video and audio connections separately. With the defaults, it uses **Android TV for video** and **Android phone for audio**. Sign in with both methods on the same account, or use the [single-login commands](#if-you-signed-in-with-one-method).

`--vstream` and `--astream` **(Crunchyroll only)** choose those connections. Choose the login that matches the connection you want to use.

| Connection | Sign-in command **(Crunchyroll only)** |
| --- | --- |
| `androidtv` | [`--device androidtv`](AUTHENTICATION.md#android-tv) |
| `android` or `androidtab` | [`--device android`](AUTHENTICATION.md#android-phone-or-tablet) |
| `chrome` or `firefox` | [`--token`](AUTHENTICATION.md#browser-cookie) |

If AniDL reports a missing login for video or audio, follow the named sign-in method and retry the command. Available quality depends on the episode, account and Crunchyroll's response.

### Choose audio and quality

By default, AniDL requests Japanese audio and uses `-q 0` to choose the highest compatible video quality. To change that for one download, add an option to your [preview command](#preview-the-episode).

- Use `--dubLang jpn,eng` to request specific audio languages. Each requested dub must be available for that episode.
- Use `--allDubs` to download the dubs available for each episode, even when a configured dub is missing.
- Use `--qall` **(Crunchyroll only)** to search all available languages for video qualities and display the full quality list. It takes longer and sends more requests, which can trigger rate limits that affect normal viewing.

The default quality list compares video sources for your selected audio languages. In the numbered list, `[Current M]` and `[Legacy M]` show source families, while labels such as `[V:jpn]` identify the video source language. Enter a listed number with `-q` to select it. Audio has its own list. For example, `[A:jpn]` marks Japanese audio.

<details>
<summary>More about audio selection and quality lists</summary>

`-s SEASON_ID` and `--srz SERIES_ID` both support several requested dubs on Crunchyroll. Separate language tags with spaces or commas. Invalid tags are reported before provider requests. A command-line dub list overrides the configured list.

Direct episode-ID and `--extid` **(Crunchyroll only)** selections use the first selected dub. `--noaudio` allows video without the selected audio; subtitle choices remain separate.

The compact quality list shows up to four Current and four Legacy entries in each of its three highest resolution groups. Hidden rows leave gaps in the numbers, and the selected entry stays visible. Switching to the all-language list can change those numbers.

Use `--qall` (also `-qall`) **(Crunchyroll only)** for one run or set `qall: true` in `config/cli-defaults.yml` for future runs. Set `qall: false` to restore the compact list or use `--qall=false` for just one run.

AniDL compares compatible video by resolution, then advertised bandwidth. The listed bandwidth, in decimal `kb/s`, is the rate advertised for the stream. The downloaded file’s average can differ. The default `-q 0` choice can change when the active catalogue changes. See [quality discovery details](fork-changes.md#discover-available-crunchyroll-legacy-qualities) and the [CLI options](ARGUMENTS.md#--qall).

</details>

### Discovery speed and limits

Looking for video in more languages takes longer. AniDL spaces out its requests to Crunchyroll.

| Selection | Default pacing | Active-work allowance |
| --- | --- | --- |
| One selected dub | Batches of eight requests with a short pause between batches. | 90 seconds |
| Multiple selected dubs or `--qall` **(Crunchyroll only)** | A fresh 700–1100 ms pause before each discovery request. | 180 seconds |

If a larger search is still running after 90 seconds of active work, AniDL may display “Discovering all qualities is taking extra time.” Let it finish. If Crunchyroll asks you to wait, follow the [playback recovery guide](CRUNCHYROLL-RECOVERY.md#retry-and-time-limits).

<details>
<summary>Adjust discovery pacing and timing checks</summary>

The automatic pause for one dub is 250–400 ms between batches, with response-time credit and a six-second cap on added waiting. Larger searches use the per-request pause shown in the table.

Use `--discovery-timmer` (also `--disctmr` or `-disctmr`) **(Crunchyroll only)** for a fixed pause in milliseconds. Its matching config keys are `discovery-timmer` and `disctmr`. Zero turns off the normal pause. Request deadlines and rate-limit waits still apply. The separate `partsize` setting controls media segment downloads. See [discovery pacing and recovery](fork-changes.md#discover-available-crunchyroll-legacy-qualities).

AniDL checks declared video and audio timelines when selecting compatible streams. If a timeline cannot be matched, AniDL falls back to the requested version. Using `--bypasssync` **(Crunchyroll only)** or setting `bypasssync: true` skips that check and can leave audio out of sync. Set `bypasssync: false` to restore it. See [timing options](ARGUMENTS.md#--bypasssync) before using it.

</details>

### Subtitles and captions

Crunchyroll includes matching closed captions by default. To skip identified captions while keeping your selected regular subtitles and signs, use `--CC false` **(Crunchyroll only)**. Set `CC: false` in the defaults for later commands. Use `--CC true` to include captions for one run.

<details>
<summary>Subtitle formats and signs</summary>

The equals forms `--CC=false` and `--CC=true` **(Crunchyroll only)** also work. The `ccTag` setting changes the caption label. It does not select signs or decide which captions to download. Signs classification keeps regional subtitle locales separate from the selected audio locale.

For subtitles only, use `--novids --noaudio`. AniDL normally converts VTT subtitles to ASS. Use `--noASSConv` to keep VTT. Completed subtitle files remain after a successful subtitle-only run, while temporary chapter files are cleaned up unless you use `--nocleanup`. See [subtitle roles and output](fork-changes.md#crunchyroll-subtitle-roles-and-subtitle-only-output).

</details>

### Muxed track flags and order

When AniDL combines a Crunchyroll download, it marks included video, audio and subtitle tracks as default. Signs subtitles are marked forced. Your player's language preferences still determine what plays.

<details>
<summary>Track order and player flags</summary>

Audio follows the `--dubLang` order. With `--allDubs`, available English tracks come first, Japanese second, then other languages by name. Subtitles follow the audio language order, with signs, full subtitles and closed captions grouped in that order for each language. Other subtitle languages follow.

Crunchyroll's automatic default flags take precedence over `defaultAudio` and `defaultSub`. The policy applies to MKV and MP4 output. See [mux flags and track order](fork-changes.md#crunchyroll-mux-flags-and-track-order) for the full behavior.

</details>

### Keeping source files and retrying failures

If combining the tracks into the final file fails, AniDL keeps its input files and leaves the download unmarked. Use `--nocleanup` to keep the separate tracks after a successful download too.

<details>
<summary>Cleanup, retries and existing files</summary>

Set `nocleanup: true` in the config to keep the input video/audio tracks, subtitles and chapters by default. Encrypted download inputs are also retained where applicable. Decryption and muxing still run; temporary duplicates and completed-download resume markers can still be removed during processing.

Crunchyroll, HIDIVE and ADN clean mux inputs only after the muxer succeeds and produces a new or updated nonempty output. MKVToolNix's warning exit is accepted when it produces that output. Failed or interrupted muxes retain their inputs and are not recorded as completed downloads. Existing download retry/resume handling remains available; `--skipmux`, subtitle-only output and other intentional mux skips keep their existing behavior.

MKVToolNix replaces an existing final MKV at the same output path. FFmpeg normally prompts unless its options include `-y` (overwrite) or `-n` (refuse). Separately, existing downloaded source files use the downloader's rewrite/stop/continue prompt; `--force y`, `--force n` or `--force c` preselects that answer.

</details>

## Check Crunchyroll playback status

Use `--check-status` **(Crunchyroll only)** to see the current capacity and the latest recorded wait. Choose your platform below. Add `--debug` if you need more detail.

<details>
<summary>🪟 Windows — Command Prompt</summary>

```bat
aniDL.exe --service crunchy --check-status
```

</details>

<details>
<summary>💻 Linux and macOS — Terminal</summary>

```sh
./aniDL --service crunchy --check-status
```

</details>

Sign in first. The check can refresh your saved login, but it won’t start playback or close anyone’s streams. Look for the available slot count and any suggested retry time. If a value shows **unknown**, AniDL couldn’t verify it. [How to read the status and retry times](CRUNCHYROLL-RECOVERY.md#read-only-playback-status)

See the [CLI reference](ARGUMENTS.md) for all options.

[Back to the setup overview](README.md#setup)
