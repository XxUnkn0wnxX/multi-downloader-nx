# Getting started: Windows GUI

This walkthrough covers the Windows setup shown in the screenshots. For source builds and CLI usage on other supported systems, see the [README](README.md). Browse the [CLI option reference](DOCUMENTATION.md), [fork notes](fork-changes.md), or [report an issue](../../../issues).

## Legal warning

This application is not endorsed by or affiliated with *Crunchyroll*, *Hidive* or *AnimationDigitalNetwork*.
This application enables you to download videos for offline viewing which may be forbidden by law in your country.
The usage of this application may also cause a violation of the *Terms of Service* between you and the stream provider.
This tool is not responsible for your actions; please make an informed decision before using this application.

## Install the required tools

Install [ffmpeg](https://www.videohelp.com/software/ffmpeg) and [MKVToolNix](https://www.videohelp.com/software/MKVToolNix). DRM decryption also needs either [Bento4 (`mp4decrypt`)](https://www.bento4.com/downloads/) or [Shaka Packager](https://github.com/stratumadev/shaka-packager/releases). The project does not include these programs.

These screenshots show example download choices; filenames and versions may differ:

| Tool | Example |
| --- | --- |
| ffmpeg | ![Example ffmpeg download](./imgs/ffmpeg.png) |
| MKVToolNix | ![Example MKVToolNix download](./imgs/mkvtoolnix.png) |
| Bento4 | ![Example Bento4 download](./imgs/bento4.png) |

Extract the tools, install MKVToolNix, then add the directories containing `ffmpeg`, `mkvmerge`, and `mp4decrypt` (or Shaka Packager) to your Windows `Path`. Alternatively, set the executable locations in [`config/bin-path.yml`](../config/bin-path.yml). Open a new terminal and check that each command runs:

![MKVToolNix installer](./imgs/mkvtoolnix-install.png)

```text
ffmpeg -version
mkvmerge --version
mp4decrypt --help
```

![Example Windows Path configuration](./imgs/env_setup_1.png)

## CDM files

CDM files are not included, and this guide does not cover how to obtain them. Supported file formats are:

- **Widevine:** a `.wvd` file, or `client_id.bin` with `private_key.pem`; the application also accepts `device_client_id_blob` with `device_private_key`.
- **PlayReady:** a `.prd` file, or `bgroupcert.dat` with `zgpriv.dat`. The supported security levels are SL2000 and SL3000. When renaming a pair of blobs, the certificate file is `bgroupcert.dat` (usually around 1 KiB) and the 32-byte key file is `zgpriv.dat`; [MediaInfo](https://mediaarea.net/en/MediaInfo) can show file sizes.

Place Widevine files in `widevine/` and PlayReady files in `playready/` beside the application. For Widevine key setup, see [Widevine keys](../widevine/README.md). If using Shaka Packager for PlayReady, use a build compatible with this application; see its [release page](https://github.com/stratumadev/shaka-packager/releases).

## Start the GUI

This fork's automated releases contain CLI archives. For the Windows GUI shown below, follow the [source build instructions](README.md#build-from-source), build with `pnpm run prebuild-gui`, then launch with `node lib/gui.js` from the checkout. If using an existing GUI archive, choose the one matching your system, extract it, and run `aniDL.exe`.

On first launch, set an optional application password or leave it blank, then choose **CONFIRM**. Reopen the application to reach the main window.

![First launch](./imgs/anidl_start.png)

![Main window](./imgs/anidl_home.png)

## Set defaults and output paths

Open **SETTINGS → Open advanced options** to edit `config/cli-defaults.yml`, or open that file directly in the application's `config/` directory. The [option reference](DOCUMENTATION.md) lists each supported setting. In its **CLI default** column, `—` means the option is not available in `cli-defaults.yml`.

For CLI runs, `skipUpdate: true` disables the [startup update notice check](README.md#fork-update-notices); `--skipUpdate` does the same for one invocation. Source and packaged CLIs otherwise check published Nightly metadata, with successful lookups cached for 24 hours. The notifier prints a link and never installs updates.

![Open advanced options](./imgs/open_adv_config.png)

For example, set the default audio endpoint and dub language in YAML:

```yaml
astream: "android"
dubLang: ["jpn", "eng"]
```

To change the output directory, edit `content` in `config/dir-path.yml`:

```yaml
content: D:/Plex/Anime/
fonts: ./fonts/
```

By default, downloads go to the `videos/` folder beside the application. Use forward slashes in Windows paths. Save YAML changes before restarting the app.

## Crunchyroll streams and quality

The video and audio endpoints are independent choices. Available renditions and access depend on the episode, account, and service response. Endpoint names do not guarantee a fixed bitrate or CBR. Choosing separate video and audio endpoints can require more than one playback session, subject to provider and account limits. For capacity checks, explicit session reset, and bounded retry behavior, see [Crunchyroll playback recovery](CRUNCHYROLL-RECOVERY.md).

For raw DASH, the numbered quality list can include compatible video from `[Current M]` and `[Legacy M]` sources, with the video source language shown as `[V:eng]` or `[V:jpn]`. By default, discovery covers the audio languages selected for the episode and retains their available variants. `--qall` expands the catalogue to all available languages. Resolution headings group the list without resetting quality numbers. `-q 0` selects the compatible candidate with the highest resolution, then advertised bandwidth, in the active catalogue; its choice can differ with `--qall`. The highest current audio rendition is selected independently for each requested dub.

With `qall` unset or false, the compact list shows the three highest resolution groups (usually 480p, 720p and 1080p), up to four Current and four Legacy entries in each group, ranked by advertised bandwidth. Distinct source entries remain separate even when their advertised bandwidths match. The selected entry stays visible even outside those groups or below those choices. Hidden rows leave gaps in the selected-language catalogue's numbers, but compact filtering does not renumber entries. Add `--qall` (or `-qall`) to use the all-language catalogue and show its full list, or set the matching config option:

```yaml
qall: true
```

Set `qall: false` to restore the selected-language compact default; `--qall=false` overrides a true config value for one run. Switching `qall` changes the active catalogue, so quality numbers may change. The four-row-per-family display limit does not reduce manifest requests within the active language scope.

Discovery pacing depends on the selected language scope:

| Mode | Default pacing | Active-work allowance |
| --- | --- | --- |
| Selected languages | Sequential batches of eight application requests; nominal random 250–400 ms gaps with response-time credit and a six-second total added-wait cap. | 90 seconds |
| `--qall` | A fresh random 600–999 ms pause before each discovery request, including the first; no response-time credit or six-second pacing cap. | 180 seconds |

An explicit `--disctmr`, `-disctmr`, or `--discovery-timmer` sets an exact fixed pause instead: per batch in normal mode, per request with `--qall`. The `discovery-timmer` and `disctmr` config keys do the same; the canonical key wins when both are present, including zero. Zero disables this pacing, while request deadlines and rate-limit recovery still apply. Fixed pauses can exceed the automatic six-second normal-mode budget. The all-language scan sends more requests and can trigger limits that affect normal viewing.

During video-quality discovery, the CLI uses one transient status row. For `--qall`, its discovery text becomes “Discovering all qualities is taking extra time” once 90 seconds of active work have elapsed, checked between requests. Retry, clearing and slot-wait messages temporarily take priority, then the extra-time text returns. Debug and non-interactive output receive at most one plain extra-time notice; GUI output does not animate the row.

A rate-limited manifest follows the existing 1, 5 and 20-second cooldown schedule, smaller retry batches, and a 45-second rate-wait budget. Playback and manifest recovery share the scheduler’s retry count; the server’s `Retry-After` can require a longer wait. Separately bounded playback-recovery sleeps can extend the active-work window. Owned-session cleanup runs without a pacing delay, and overlapping pacing/recovery waits use the longer applicable requirement. A discovery timeout or a required pause that cannot fit stops the operation after cleanup. See [Crunchyroll playback recovery](CRUNCHYROLL-RECOVERY.md) for the TSD rules. `partsize` controls concurrent media segment downloads and does not control discovery pacing.

The audio quality list uses `[A:eng]` or `[A:jpn]` for the audio language, marks its selected row, and shows the audio server below it. These display changes apply to Crunchyroll.

Quality-list rates use decimal `kb/s` (1 kb/s = 1,000 bits/s). `KiB/s` measures 1,024 bytes/s.

Video timing checks compare declared timelines within the active language scope, including across multiple selected dubs; `--qall` retains checks across its broader catalogue. Matching timelines do not prove decoded synchronization or identical edits. If a check fails or timing is unknown, selection falls back to the requested version. `--bypasssync` (or `bypasssync: true` in config) bypasses video/audio timing checks and can cause desynchronization; `bypasssync: false` disables the override. `--noaudio` still skips checks that require audio. Subtitle cue times are not used as a timing reference. No automatic trimming, stretching, or offset is applied.

## Check Crunchyroll playback status

Use this CLI-only command to inspect a read-only capacity snapshot and the latest recorded wait information:

```sh
aniDL --service crunchy --check-status
```

Only `--service crunchy` and optional `--debug` are accepted. The command requires an existing saved login and performs the usual token refresh first; that refresh may take additional time. The status snapshot is bounded to 15 seconds and does not start playback or clear sessions. Known capacity and available slots are shown even if another lookup fails; missing or incomplete values are unknown, not zero. A snapshot failure returns an error after any partial results are shown.

Status API `Retry-After` information is reported separately from the historical playback wait recorded after an earlier playback refusal. When active, the record includes its observation time, remaining wait and earliest suggested retry; an elapsed or missing record leaves current playback unverified. This command does not verify whether playback is currently allowed because it does not start playback. The local account-bound wait record is informational and best effort; it never changes recovery behavior. See [Crunchyroll playback recovery](CRUNCHYROLL-RECOVERY.md) for session recovery and its limits.

## Log in

### Crunchyroll CLI

For a new Crunchyroll CLI login, run:

```sh
aniDL --service crunchy --device
```

Open the printed activation page, enter the displayed code, and approve the request. The CLI shows the account after approval and saves the device login for later token refresh. If the primary auth endpoint is unavailable, a warning identifies the beta API fallback. The Crunchyroll CLI `--auth`, `--username`, `--password`, and `--silentAuth` options direct users to `--device`. The older browser-cookie `--token` option remains available for existing workflows; see [its option entry](DOCUMENTATION.md#--token).

### GUI and other services

In the GUI, choose a service and select **AUTHENTICATE**. Crunchyroll's existing GUI cookie flow accepts the `etp_rt` value in the username field. Other services use the credentials requested by their dialog. In the CLI, other services continue to use `--auth`.

## Add episodes to the queue

Choose a service, then open **ADD TO QUEUE**:

![Add to queue](./imgs/add_to_queue_1.png)

1. **Search:** enter a series title and select a result. Its ID fills the **Show ID** field. If results do not appear, press Enter to submit the search.
2. **Show ID:** alternatively, enter an ID directly. For Crunchyroll, the ID is the value after `/series/` in the show URL, for example `https://www.crunchyroll.com/series/G4PH0WXVJ/spy-x-family`.
3. **List Episodes:** load the episode list, select episodes, and add them to the **Episode Select** field. You can also enter a comma-separated list such as `,1,2,5,8`; specials use an `S` prefix such as `S1`.
4. **Download All / Download All But:** choose whether to include every episode or exclude the numbers entered in **Episode Select**.
5. **Language options:** choose dub and subtitle languages. See [`--dubLang`](DOCUMENTATION.md#--dublang) and [`--dlsubs`](DOCUMENTATION.md#--dlsubs).
6. **Filename Overwrite:** set a per-queue filename format. See [`--fileName`](DOCUMENTATION.md#--filename).

![Episode selection](./imgs/ep_select.png)

Episode-window settings apply only to that queue. To pause or resume queued work, use **STOP QUEUE** / **START QUEUE**. **CLEAR QUEUE** removes queued items that are not already downloading.

## Preview from the CLI

`--dry-run` is an explicit CLI or programmatic action and cannot be enabled through `cli-defaults.yml`. It prints metadata, available qualities, and selected stream URLs, then stops before licenses, media, subtitle, font, or chapter downloads; decryption, muxing, and completed-download history writes are skipped. Normal authentication, refresh, metadata, and required HEAD requests may still run. With episode selection, explicit `--tsd` or config `tsd: true` checks Crunchyroll playback capacity before every episode, including previews, and clears other sessions only when the validated assessment is full and the command clear allowance is available. A standalone explicit `--tsd` instead force-clears the validated listed sessions even with `--dry-run` or `--debug`; config alone does not trigger that reset. `--debug` keeps full request diagnostics.

```sh
aniDL --service crunchy -s SEASON_ID -e 1 --dry-run
```

To clear active Crunchyroll playback sessions without selecting an episode, run `aniDL --service crunchy --tsd`. The standalone command checks once and reports how many sessions were closed and how many remain. `--dry-run` and `--debug` can accompany this command. Episode capacity checks and any required reset finish before playback begins. See [Crunchyroll playback recovery](CRUNCHYROLL-RECOVERY.md) for capacity uncertainty, waiting and retry limits. Resetting does not log out, and a rate limit can persist afterward.

See the [CLI reference](DOCUMENTATION.md) for all flags, and the [README](README.md#build-from-source) for source setup and target commands.
