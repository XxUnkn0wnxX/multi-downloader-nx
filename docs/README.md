# Anime Downloader NX by AniDL

[![Discord Shield](https://discord.com/api/guilds/884479461997805568/widget.png?style=banner2)](https://discord.gg/qEpbWen5vq)

This downloader can download anime from different sites. Currently supported are *Crunchyroll*, *Hidive* and *AnimationDigitalNetwork*.

## Legal Warning

This application is not endorsed by or affiliated with *Crunchyroll*, *Hidive* or *AnimationDigitalNetwork*. This application enables you to download videos for offline viewing which may be forbidden by law in your country. The usage of this application may also cause a violation of the *Terms of Service* between you and the stream provider. This tool is not responsible for your actions; please make an informed decision before using this application.

## Dependencies

* [ffmpeg](https://www.videohelp.com/software/ffmpeg) >= 4.0.0
* [MKVToolNix](https://www.videohelp.com/software/MKVToolNix) >= 60.0.0

### Paths Configuration

By default this application uses the following paths to programs (main executables):

* `ffmpeg.exe` (Windows) or `ffmpeg` (other) (From PATH)
* `mkvmerge.exe` (Windows) or `mkvmerge` (other) (From PATH)
* `mp4decrypt.exe` (Windows) or `mp4decrypt` (other) (From PATH) (or shaka-packager)
* `shaka-packager.exe` (Windows) or `shaka-packager` (other) (From PATH) (or mp4decrypt)

To change these paths you need to edit `bin-path.yml` in `./config/` directory.

## CLI Information

See [the documentation](DOCUMENTATION.md) for a complete list of available options. You can define command defaults by editing `cli-defaults.yml` in the `./config/` directory.

### Example usage

#### Logging in

Most services require you to be logged in, in order to download from, an example of how you would login is:

```shell
AniDL --service {ServiceName} --auth
```

For Crunchyroll, use `AniDL --service crunchy --device` instead of `--auth`.

#### Searching

In order to find the IDs to download, you can search from each service by using the `--search` flag like this:

```shell
AniDL --service {ServiceName} --search {SearchTerm}
```

#### Downloading

Once you have the ID which you can obtain from using the search or other means, you are ready to download, which you can do like this:

```shell
AniDL --service {ServiceName} -s {SeasonID} -e {EpisodeNumber}
```

## Building and running from source

### Build Dependencies

Dependencies that are only required for running from code. These are not required if you are using the prebuilt binaries.

* [Node.js](https://nodejs.org/) >= 18.0.0
* [npm](https://www.npmjs.org/) >= 6.9.0
* [pnpm](https://pnpm.io/) >= 7.0.0

### Build Setup

Please note that Node.js, npm, and pnpm must be installed on your system. See the [pnpm installation guide](https://pnpm.io/installation).

On the current repository page, select **Code** and copy its clone URL. Use that URL with `git clone` to clone this repository.

`cd` into the cloned directory and run `pnpm i`. Next, decide if you want to package the application, build the code, or run from typescript.

### Run from TypeScript

You can run the code from native TypeScript, this requires tsx which you can install with pnpm with the following command: `pnpm -g i tsx`

Afterwords, you can run the application like this:

* CLI: `tsx ./index.ts --help`
* GUI: `pnpm gui` OR `tsx ./gui.ts` (If already compiled)

### Run as JavaScript

If you want to build the application into JavaScript code to run, you can do that as well like this:

* CLI: `pnpm run prebuild-cli`
* GUI: `pnpm run prebuild-gui`

Then you can cd into the `lib` folder and you will be able to run the CLI or GUI as follows:

* CLI: `node ./index.js --help`

### Build the application into an executable

To package the application, run `pnpm run build-{platform}-{arch}-{type}`, for example `pnpm run build-windows-x64-cli`. See [package.json](../package.json) for the available targets.

## DRM Decryption

### Decryption Requirements

* [Bento4 (mp4decrypt)](https://www.bento4.com/downloads/) - Only required for decrypting (or use shaka-packager)
* [shaka-packager releases](https://github.com/stratumadev/shaka-packager/releases) - Only required for decrypting (or use mp4decrypt)

### Instructions (Widevine)

In order to decrypt DRM content, you will need to have a dumped CDM, after that you will need to place the CDM files (`device_client_id_blob` and `device_private_key` or `client_id.bin` and `private_key.pem`) into the `./widevine/` directory. For legal reasons we do not include the CDM with the software, and you will have to source one yourself.

### Instructions (Playready)

Playready CDMs are very easy to obtain, you can find them even on Github.
Place the CDM files (bgroupcert.dat and zgpriv.dat) in the `./playready/` directory and you're all set!
