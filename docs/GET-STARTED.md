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

Place Widevine files in `widevine/` and PlayReady files in `playready/` beside the application. If using Shaka Packager for PlayReady, use a build compatible with this application; see its [release page](https://github.com/stratumadev/shaka-packager/releases).

## Start the GUI

Check this repository's [Releases page](../../../releases) for a Windows GUI archive. If one is available, choose the archive matching your system and extract it. Release archives are not guaranteed; if none is listed, follow the [source build instructions](README.md#build-from-source).

Run `aniDL.exe`. On first launch, set an optional application password or leave it blank, then choose **CONFIRM**. Reopen the application to reach the main window.

![First launch](./imgs/anidl_start.png)

![Main window](./imgs/anidl_home.png)

## Set defaults and output paths

Open **SETTINGS → Open advanced options** to edit `config/cli-defaults.yml`, or open that file directly in the application's `config/` directory. The [option reference](DOCUMENTATION.md) lists each supported setting. In its **CLI default** column, `—` means the option is not available in `cli-defaults.yml`.

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

The video and audio endpoints are independent choices. Available renditions and access depend on the episode, account, and service response. Endpoint names do not guarantee a fixed bitrate or CBR. Choosing separate video and audio endpoints can require more than one playback session, subject to provider and account limits.

For raw DASH, the numbered quality list can include compatible video from `[Current M]` and `[Legacy M]` sources, with the source language shown as `[eng]` or `[jpn]`. Resolution headings group the list without resetting quality numbers. `-q 0` selects the highest dimensions, then advertised bandwidth. The highest current audio rendition is selected independently for each requested dub.

Quality-list rates use decimal `kb/s` (1 kb/s = 1,000 bits/s). `KiB/s` measures 1,024 bytes/s.

Cross-language selection compares declared video timing; that check does not prove decoded synchronization or identical edits. If a check fails or timing is unknown, selection falls back to the requested version. `--forcevideo` (alias `--forcevid`) bypasses timing eligibility and may cause audio/video desynchronization. `--noaudio` skips the check. Subtitle cue times are not used as a timing reference. No automatic trimming, stretching, or offset is applied.

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

`--dry-run` prints metadata, available qualities, and selected stream URLs, then stops before licenses, media, subtitle, font, or chapter downloads; decryption, muxing, and completed-download history writes are skipped. Normal authentication, refresh, metadata, and required HEAD requests may still run. `--debug` keeps full request diagnostics.

```sh
aniDL --service crunchy -s SEASON_ID -e 1 --dry-run
```

See the [CLI reference](DOCUMENTATION.md) for all flags, and the [README](README.md#build-from-source) for source setup and target commands.
