# multi-downloader-nx v5.8.8 (Nightly) [Rev7]

[🚀 Getting started](GET-STARTED.md) · [🔑 Sign in to a service](AUTHENTICATION.md) · [Report an issue](../../../issues)

Run a service command as `aniDL --service <name> <options>`, using `crunchy`, `hidive` or `adn`. The global list covers all three services. Open a service section for its additional options.

For general help, run `aniDL --help`. For service-specific help, use `aniDL --service crunchy --help`, `aniDL --service hidive --help` or `aniDL --service adn --help`. [Crunchyroll options](#crunchyroll-only-commands-and-options) · [HIDIVE options](#hidive-commands-and-options) · [ADN options](#adn-commands-and-options)

## Legal Warning

This application is not endorsed by or affiliated with *Crunchyroll*, *HIDIVE* or *AnimationDigitalNetwork*.
This application enables you to download videos for offline viewing which may be forbidden by law in your country.
The usage of this application may also cause a violation of the *Terms of Service* between you and the stream provider.
This tool is not responsible for your actions; please make an informed decision before using this application.

## CLI Options

### Legend

- `${someText}` shows that you should replace this text with your own.
  - For example: `--username ${someText}` → `--username Izuco`.

Quality-list rates use decimal `kb/s` (1 kb/s = 1,000 bits/s). `KiB/s` measures 1,024 bytes/s. Manifest bandwidth is an advertised rate and may differ from a file's measured average.

## Global options

These options apply across services. Start the command with the service selector when required, for example `aniDL --service hidive --auth`.

#### `-v, --version`

Print the application version. Put the service selector first, for example `aniDL --service crunchy --version`.


### Authentication
#### `--auth`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| All services | `--auth` | `boolean` | `No` | `—` | `—` |

Use `--service hidive --auth` or `--service adn --auth` to sign in with a username or email and password. Only Crunchyroll disables sign-in through `--auth`. On Crunchyroll the command shows a reminder. Use `--device android` for the former phone login, `--device androidtv` for TV, or `--token` for a browser cookie. [Service sign-in guide](AUTHENTICATION.md).

### Fonts
#### `--fontName`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| All services | `--fontName ${fontName}` | `string` | `No` | `—` | `—` |

Set the font to use in subtiles

### Search
#### `--search`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| All services | `--search ${search}` | `string` | `No` | `-f` | `—` |

Search of an anime by the given string
#### `--page`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| All services | `--page ${page}` | `number` | `No` | `-p` | `—` |

Select a page of search results. The first page is 1 on Crunchyroll and HIDIVE, or 0 on ADN.

### Downloading
#### `-s`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| All services | `-s ${ID}` | `string` | `No` | `—` | `—` |

Select a season ID on Crunchyroll or HIDIVE, or a show ID on ADN. On Crunchyroll, combine -s with --srz to select one season of a series, or use --dubLang or --allDubs to select audio languages.
#### `-e`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| All services | `-e ${selection}` | `string` | `No` | `--episode` | `—` |

Set the episode(s) to download from any given show.
For multiple selection: 1-4 OR 1,2,3,4 
For special episodes: S1-4 OR S1,S2,S3,S4 where S is the special letter
#### `-q`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `-q ${qualityLevel}` | `number` | `No` | `—` | `0` | `q: ` |

Use the listed quality number; 0 selects the maximum quality. Crunchyroll ranks by dimensions, then advertised bitrate, and compares compatible current and legacy video within exactly the selected audio languages while keeping the highest current audio for the requested dubs. Use --qall to include all languages. Crunchyroll reports a short reason when checks force video fallback. Its compact quality list shows up to four Current and four Legacy entries in each of the top three resolution groups, with stable full-catalogue numbers; compact view may have gaps where rows are hidden. Use --qall to show every eligible video quality. Short manifest and video-source language tags such as [V:jpn] identify each row, which marks the selected entry. Its audio quality list uses independent [A:eng] language tags and shows the selected audio server below the row. A fallback prints only the discarded and re-selected rows, when applicable.
#### `-x`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All services | `-x ${server}` | `number` | `No` | `--server` | [`1`, `2`, `3`, `4`] | `1` | `x or server: ` |

Select the server to use
#### `--dlsubs`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All services | `--dlsubs ${sub1} ${sub2}` | `array` | `No` | `—` | [`all`, `none`, `un`, `en`, `en-IN`, `es-419`, `es-ES`, `pt-BR`, `pt-PT`, `fr`, `de`, `ar`, `it`, `ru`, `tr`, `hi`, `zh`, `zh-CN`, `zh-TW`, `zh-HK`, `ko`, `ca-ES`, `pl-PL`, `th-TH`, `ta-IN`, `ms-MY`, `vi-VN`, `id-ID`, `te-IN`, `ja`] | `all` | `dlsubs: ` |

Download subtitles by language tag (space-separated)
Crunchy Only: un, en, en-IN, es-419, es-419, es-ES, pt-BR, pt-PT, fr, de, ar, ar, it, ru, tr, hi, zh-CN, zh-TW, zh-HK, ko, ca-ES, pl-PL, th-TH, ta-IN, ms-MY, vi-VN, id-ID, te-IN, ja
#### `--skipMuxOnSubFail`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--skipMuxOnSubFail` | `boolean` | `No` | `—` | `false` | `skipMuxOnSubFail: ` |

Skips muxing when a subtitle download fails.
#### `--dry-run`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--dry-run` | `boolean` | `No` | `--dryRun` | `false` | `—` |

Preview available qualities and stream URLs without downloading files. During download previews, authentication and token refresh still run. This option is CLI or programmatic only and cannot be enabled through cli-defaults.
#### `--novids`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| All services | `--novids` | `boolean` | `No` | `—` | `—` |

Skip downloading videos
#### `--nosubs`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| All services | `--nosubs` | `boolean` | `No` | `—` | `—` |

Skip downloading subtitles
#### `--dubLang`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All services | `--dubLang ${dub1} ${dub2}` | `array` | `No` | `—` | [`und`, `eng`, `spa`, `spa-419`, `spa-ES`, `por`, `fra`, `deu`, `ara-ME`, `ara`, `ita`, `rus`, `tur`, `hin`, `cmn`, `zho`, `chi`, `zh-HK`, `kor`, `cat`, `pol`, `tha`, `tam`, `may`, `vie`, `ind`, `tel`, `jpn`] | `jpn` | `dubLang: ` |

Set the language to download: 
Crunchy Only: und, eng, eng, spa, spa-419, spa-ES, por, por, fra, deu, ara-ME, ara, ita, rus, tur, hin, zho, chi, zh-HK, kor, cat, pol, tha, tam, may, vie, ind, tel, jpn
Separate language tags with spaces, commas or a mixture, for example --dubLang eng,jpn hin. Invalid tags are listed and rejected before provider requests. Crunchyroll: both -s and --srz support multiple languages. Direct episode-ID and --extid requests use only the first dub. Every explicitly requested dub must be available for the episode; --allDubs downloads the available dubs instead. --noaudio skips this requirement. Selecting more than two dubs prints a multi-stream discovery warning.
#### `--all`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--all` | `boolean` | `No` | `—` | `false` | `all: ` |

Used to download all episodes from the show
#### `--fontSize`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--fontSize ${fontSize}` | `number` | `No` | `—` | `55` | `fontSize: ` |

Set the ASS subtitle font size. On Crunchyroll and HIDIVE, set `originalFontSize: false` in the CLI defaults to use your chosen size when converting WebVTT. ADN uses the size directly.
#### `--allDubs`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| All services | `--allDubs` | `boolean` | `No` | `—` | `—` |

Download the audio dubs actually available for each episode; a missing configured or expected language does not stop the download. For example, Japanese can download even when English is unavailable. For each episode independently, Crunchyroll compares video manifests for the found audio languages and uses the same multi-audio timing checks and compact quality output. This option always prints a multi-stream discovery warning, even when only one or two dubs are available. --qall instead uses the full-stream warning; warnings are printed only once per command.
#### `--but`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| All services | `--but` | `boolean` | `No` | `—` | `—` |

Download everything but the -e selection
#### `--downloadArchive`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| All services | `--downloadArchive` | `boolean` | `No` | `—` | `—` |

Used to download all archived shows
#### `--partsize`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--partsize ${amount}` | `number` | `No` | `—` | `10` | `partsize: ` |

Set the amount of parts to download at once
If you have a good connection try incresing this number to get a higher overall speed
#### `--fsRetryTime`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--fsRetryTime ${time in seconds}` | `number` | `No` | `—` | `5` | `fsRetryTime: ` |

Set the time the downloader waits before retrying if an error while writing the file occurs
#### `--force`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--force ${option}` | `string` | `No` | `—` | [`y`, `Y`, `n`, `N`, `c`, `C`] | `—` |

If a file already exists, the tool will ask you how to proceed. With this, you can answer in advance.

### Muxing
#### `--mp4`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--mp4` | `boolean` | `No` | `—` | `false` | `mp4: ` |

If selected, the output file will be an mp4 file (not recommended tho)
#### `--skipmux`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| All services | `--skipmux` | `boolean` | `No` | `—` | `—` |

Skip muxing video, audio and subtitles
#### `--nocleanup`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--nocleanup` | `boolean` | `No` | `—` | `false` | `nocleanup: ` |

Retain mux input tracks, subtitles, chapters and encrypted download inputs where applicable. Decryption and muxing still run. Internal temporary duplicates and completed-download resume markers may still be removed. Failed muxes retain their inputs even without this flag.
#### `--skipSubMux`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--skipSubMux` | `boolean` | `No` | `—` | `false` | `skipSubMux: ` |

Skip muxing the subtitles
#### `--forceMuxer`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All services | `--forceMuxer ${muxer}` | `string` | `No` | `—` | [`ffmpeg`, `mkvmerge`] | `undefined` | `forceMuxer: ` |

Force the program to use said muxer or don't mux if the given muxer is not present
#### `--videoTitle`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| All services | `--videoTitle ${title}` | `string` | `No` | `—` | `—` |

Set the video track name of the merged file
#### `--mkvmergeOptions`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--mkvmergeOptions ${args}` | `array` | `No` | `—` | `--no-date,--disable-track-statistics-tags,--engage no_variable_data` | `mkvmergeOptions: ` |

Set the options given to mkvmerge
#### `--ffmpegOptions`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--ffmpegOptions ${args}` | `array` | `No` | `—` | `` | `ffmpegOptions: ` |

Set the options given to ffmpeg

### Filename Template
#### `--fileName`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--fileName ${fileName}` | `string` | `No` | `—` | `[${service}] ${showTitle} - S${season}E${episode} [${height}p]` | `fileName: ` |

Set the filename template. Use ${variable_name} to insert variables.
You can also create folders by inserting a path seperator in the filename
You may use 'title', 'episode', 'showTitle', 'seriesTitle', 'season', 'width', 'height', 'service' as variables.
#### `--numbers`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--numbers ${number}` | `number` | `No` | `—` | `2` | `numbers: ` |

Set how long a number in the title should be at least.
Set in config: 3; Episode number: 5; Output: 005
Set in config: 2; Episode number: 1; Output: 01
Set in config: 1; Episode number: 20; Output: 20
#### `--override`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--override "${toOverride}='${value}'"` | `array` | `No` | `—` | `` | `override: ` |

Override a template variable

### Debug
#### `--debug`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--debug` | `boolean` | `No` | `—` | `false` | `debug: ` |

Show local version and platform details, alone or with --help. Add --debug to a service command for detailed output (which may include tokens).

### Utilities
#### `--service`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All services | `--service ${service}` | `string` | `Yes` | `—` | [`crunchy`, `hidive`, `adn`] | `` | `service: ` |

Start with --service followed by crunchy, hidive, or adn. Specify one service per command. Add --help to see its commands.
#### `--update`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| All services | `--update` | `boolean` | `No` | `—` | `—` |

Updates disabled on this fork. Download updates: https://github.com/XxUnkn0wnxX/multi-downloader-nx/releases/tag/nightly-fork
#### `--skipUpdate`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--skipUpdate` | `boolean` | `No` | `—` | `false` | `skipUpdate: ` |

If true, the tool won't check for updates
#### `--proxy`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--proxy ${proxy_url}` | `string` | `No` | `—` | `` | `proxy: ` |

Uses Proxy on geo-restricted or geo-defining endpoints (e.g. `https://127.0.0.1:1080` or `http://127.0.0.1:1080`)
#### `--proxyAll`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| All services | `--proxyAll` | `boolean` | `No` | `—` | `false` | `proxyAll: ` |

Proxies everything, not recommended. Proxy needs to be defined.

### Help
#### `--help`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| All services | `--help` | `boolean` | `No` | `-h` | `—` |

Show the help output

<a id="crunchyroll-only-commands-and-options"></a>

## Crunchyroll options

<details>
<summary>Show options for <code>--service crunchy</code> (Crunchyroll)</summary>

Use `--service crunchy` before these options. For the full help on your computer, run `aniDL --service crunchy --help`.

[🔑 Crunchyroll sign-in walkthroughs](AUTHENTICATION.md#crunchyroll)



### Authentication
#### `--device`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --device [type]` | `string` | `No` | `—` | `—` |

Crunchyroll only. After `--service crunchy`, use `--device` on its own for help. Use `--device androidtv` to enter an activation code online or `--device android` to sign in and paste the full browser address into the terminal. With `--dry-run`, phone sign-in shows the link and hidden-paste prompt, and TV sign-in requests a real code and shows its expiry. Both previews cancel automatically before opening a browser, reading a callback or polling for approval. Neither preview exchanges tokens or saves a session. [Android TV steps](AUTHENTICATION.md#android-tv) · [Android phone steps](AUTHENTICATION.md#android-phone-or-tablet).
#### `--silentAuth`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --silentAuth` | `boolean` | `No` | `—` | `false` | `silentAuth: ` |

For Crunchyroll CLI, use --device or --token.
#### `--token`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --token [cookie-or-file]` | `string` | `No` | `—` | `undefined` | `token: ` |

Start with `--service crunchy`. Use `--service crunchy --token` for input examples. Supply the UUID-shaped etp_rt cookie value (optionally prefixed with etp_rt=), or the path to a file containing the raw token or a Netscape cookies export. The file may have any name or extension. The resulting web session is saved alongside any TV and phone sessions. [Browser cookie steps](AUTHENTICATION.md#browser-cookie).

### Fonts
#### `--dlFonts`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --dlFonts` | `boolean` | `No` | `—` | `—` |

Crunchyroll uses a variaty of fonts for the subtitles.
Use this command to download all the fonts and add them to the muxed **mkv** file.

### Search
#### `--search-type`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --search-type ${type}` | `string` | `No` | `—` | [`''`, `top_results`, `series`, `movie_listing`, `episode`] | `` | `search-type: ` |

Search only for type of anime listings (e.g. episodes, series)
#### `--locale`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll, ADN | `--service crunchy --locale ${locale}` | `string` | `No` | `—` | [`''`, `und`, `en-US`, `en-IN`, `es-LA`, `es-419`, `es-ES`, `pt-BR`, `pt-PT`, `fr-FR`, `de-DE`, `ar-ME`, `ar-SA`, `it-IT`, `ru-RU`, `tr-TR`, `hi-IN`, `zh-CN`, `zh-TW`, `zh-HK`, `ko-KR`, `ca-ES`, `pl-PL`, `th-TH`, `ta-IN`, `ms-MY`, `vi-VN`, `id-ID`, `te-IN`, `und`, `fr`, `de`, `pl`] | `en-US` | `locale: ` |

Set the local that will be used for the API.
#### `--new`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --new` | `boolean` | `No` | `—` | `—` |

Get last updated series list

### Downloading
#### `--absolute`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --absolute` | `boolean` | `No` | `—` | `—` |

Use absolute numbers for the episode. If not set, it will use the default index numbers
#### `--movie-listing`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --movie-listing ${ID}` | `string` | `No` | `--flm` | `—` |

Get video list by Movie Listing ID
#### `--show-raw`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --show-raw ${ID}` | `string` | `No` | `--sraw` | `—` |

Get Raw Show data
#### `--season-raw`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --season-raw ${ID}` | `string` | `No` | `--seraw` | `—` |

Get Raw Season data
#### `--show-list-raw`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --show-list-raw` | `boolean` | `No` | `--slraw` | `—` |

Get Raw Show list data
#### `--series`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| Crunchyroll, HIDIVE | `--service crunchy --series ${ID}` | `string` | `No` | `--srz` | `—` |

Use the numeric series ID for HIDIVE. On Crunchyroll, use the series ID. This supports multiple --dubLang languages and --allDubs. Add -s to select one Crunchyroll season.
#### `--extid`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --extid ${selection}` | `string` | `No` | `--externalid` | `—` |

Look up or download a title by its legacy Crunchyroll ID.
#### `--qall`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --qall` | `boolean` | `No` | `—` | `false` | `qall: ` |

Scan all languages and show every eligible Crunchyroll video quality. Default pacing samples 700–1100 ms before each discovery request; an explicit discovery timer replaces it. Active discovery work is limited to 180 seconds, with an extra-time message on the existing status row after 90 seconds. This sends more requests and may trigger rate limits affecting normal viewing. Quality numbers remain stable within the active catalogue; switching --qall can change them.
#### `--discovery-timmer`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --discovery-timmer ${milliseconds}` | `number` | `No` | `--disctmr` | `automatic` | `discovery-timmer or disctmr: ` |

Set an exact pause in milliseconds between normal eight-request discovery batches, or before each request for multi-dub or --qall discovery. Unset uses automatic 250–400 ms batch gaps with response-time credit and a six-second added-wait budget, or 700–1100 ms per request for multi-dub or --qall. Zero disables normal pacing. Fixed pauses are not capped at six seconds; discovery and request deadlines and 429 recovery still apply.
#### `--dlVideoOnce`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll, ADN | `--service crunchy --dlVideoOnce` | `boolean` | `No` | `—` | `false` | `dlVideoOnce: ` |

On ADN, request the best selected video quality once and use the lowest video quality for later dubs. On Crunchyroll, download video once for per-language DASH downloads. Combined HLS downloads may include lower-quality video with later audio tracks. Global Crunchyroll DASH selection already shares one video. --keepAllVideos retains downloaded video tracks.
#### `--chapters`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll, ADN | `--service crunchy --chapters` | `boolean` | `No` | `—` | `true` | `chapters: ` |

Will fetch the chapters and add them into the final video.
#### `--originalFontSize`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll, HIDIVE | `--service crunchy --originalFontSize` | `boolean` | `No` | `—` | `true` | `originalFontSize: ` |

If selected, it will prefer to keep the original Font Size defined by the service.
#### `--cstream`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --cstream ${device}` | `string` | `No` | `--cs` | [`androidtv`, `android`, `androidtab`, `chrome`, `firefox`, `none`] | `—` |

(Please use --vstream and --astream instead, this will deprecate soon)
#### `--vstream`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --vstream ${device}` | `string` | `No` | `--vs` | [`androidtv`, `android`, `androidtab`, `chrome`, `firefox`, `none`] | `androidtv` | `vstream or vs: ` |

Select the video endpoint. The endpoint uses its matching saved Crunchyroll session. See [stream endpoint sign-in requirements](GET-STARTED.md#crunchyroll-streams-and-quality).
#### `--astream`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --astream ${device}` | `string` | `No` | `--as` | [`androidtv`, `android`, `androidtab`, `chrome`, `firefox`, `none`] | `android` | `astream or as: ` |

Select the audio endpoint independently of the video endpoint. A single Crunchyroll command can use multiple saved sessions from the same account. For example, `--vstream androidtv --astream android` uses the Android TV session for video and the Android phone session for audio. See [stream endpoint sign-in requirements](GET-STARTED.md#crunchyroll-streams-and-quality).
#### `--tsd`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --tsd` | `boolean` | `No` | `—` | `false` | `tsd: ` |

Before each episode, assess account playback capacity and clear the validated session list only when full and the command clear allowance is available. Finish all planned deletions and fresh verification before resuming below the API-derived account limit. Explicit standalone --tsd force-clears listed sessions and requires verified zero. For qualifying playback refusals, actual TSD intervention uses bounded recovery instead of ordinary retry tiers for that unresolved acquisition group; otherwise ordinary recovery remains available. This does not log out and may not clear a rate limit. See [Crunchyroll playback recovery](CRUNCHYROLL-RECOVERY.md).
#### `--hslang`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --hslang ${hslang}` | `string` | `No` | `—` | [`none`, `un`, `en`, `en-IN`, `es-419`, `es-ES`, `pt-BR`, `pt-PT`, `fr`, `de`, `ar`, `it`, `ru`, `tr`, `hi`, `zh`, `zh-CN`, `zh-TW`, `zh-HK`, `ko`, `ca-ES`, `pl-PL`, `th-TH`, `ta-IN`, `ms-MY`, `vi-VN`, `id-ID`, `te-IN`, `ja`] | `none` | `hslang: ` |

Download video with specific hardsubs
#### `--noASSConv`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll, HIDIVE | `--service crunchy --noASSConv` | `boolean` | `No` | `—` | `false` | `noASSConv: ` |

Disables VTT conversion to ASS.
#### `--noSubFix`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --noSubFix` | `boolean` | `No` | `—` | `false` | `noSubFix: ` |

Disables all subtitle fixes and downloads raw subtitles.
#### `--srtAssFix`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --srtAssFix` | `boolean` | `No` | `—` | `true` | `srtAssFix: ` |

Fixes the recently changed Crunchyroll subtitles provided by Closed Caption Converter.
#### `--layoutResFix`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --layoutResFix` | `boolean` | `No` | `—` | `true` | `layoutResFix: ` |

Applies the LayoutRes Fix to all ASS subtitles.
#### `--scaledBorderAndShadowFix`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --scaledBorderAndShadowFix` | `boolean` | `No` | `—` | `true` | `scaledBorderAndShadowFix: ` |

Applies the ScaledBorderAndShadow Fix to all ASS subtitles.
#### `--scaledBorderAndShadow`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --scaledBorderAndShadow ${yes/no}` | `string` | `No` | `—` | [`yes`, `no`] | `yes` | `scaledBorderAndShadow: ` |

Select if ScaledBorderAndShadow should be set to "yes" or "no".
#### `--originalScriptFix`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --originalScriptFix` | `boolean` | `No` | `—` | `true` | `originalScriptFix: ` |

Removes the URL in the Original Script line of the ASS subtitles, it prevents from bricking the subs in VLC (Fonts not loading when url not returning 200).
#### `--subtitleTimestampFix`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --subtitleTimestampFix` | `boolean` | `No` | `—` | `false` | `subtitleTimestampFix: ` |

Fixes subtitle dialogues that go over the video length (deletes dialogues where start is over video length and updates the end timestamp when end is over video length).
#### `--bypasssync`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --bypasssync` | `boolean` | `No` | `—` | `false` | `bypasssync: ` |

Bypass video/audio timing checks for selected dubs and all-language --qall discovery. May cause audio/video desync. Not needed with --noaudio; subtitle timings are never used.
#### `--noaudio`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| Crunchyroll, HIDIVE | `--service crunchy --noaudio` | `boolean` | `No` | `—` | `—` |

Skip downloading audio
#### `--CC`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --CC ${boolean}` | `boolean` | `No` | `—` | `true` | `CC: ` |

Include tracks identified as closed captions by Crunchyroll. Use --CC false or CC: false to skip captions while keeping selected regular subtitles and signs. Use --CC true to include captions for one command. The default is true; ccTag only controls the caption label.
#### `--waittime`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll, ADN | `--service crunchy --waittime ${waittime}` | `number` | `No` | `—` | `0` | `waittime: ` |

Set the wait between downloads in milliseconds
#### `--addArchive`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| Crunchyroll, HIDIVE | `--service crunchy --addArchive` | `boolean` | `No` | `—` | `—` |

Crunchyroll accepts either -s for a season or --srz for a series. HIDIVE accepts -s for a season.

### Muxing
#### `--keepAllVideos`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll, ADN | `--service crunchy --keepAllVideos` | `boolean` | `No` | `—` | `false` | `keepAllVideos: ` |

If set to true, it will keep all videos in the merge process, rather than discarding the extra videos.
#### `--syncTiming`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll, ADN | `--service crunchy --syncTiming` | `boolean` | `No` | `—` | `false` | `syncTiming: ` |

If enabled attempts to sync timing for multi-dub downloads.
NOTE: This is currently experimental and syncs audio and subtitles, though subtitles has a lot of guesswork
If you find bugs with this, please report it in the discord or github

### Filename Template
#### `--ccTag`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --ccTag ${tag}` | `string` | `No` | `—` | `cc` | `ccTag: ` |

Set the label appended to closed-caption tracks and filenames; this does not select signs or control caption downloads.

### Utilities
#### `--check-status`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --check-status` | `boolean` | `No` | `—` | `—` |

CLI-only action: use --service crunchy and optional --debug; configuration cannot activate it. After normal login refresh, one read-only snapshot has a 15-second deadline. It reports capacity and any current status-request HTTP 429/Retry-After separately from the last observed playback wait; it does not start playback.
#### `--raw`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --raw` | `boolean` | `No` | `—` | `false` | `raw: ` |

Print the raw API response for --new
#### `--rawoutput`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll | `--service crunchy --rawoutput ${path}` | `string` | `No` | `—` | `` | `rawoutput: ` |

Save the raw response from --new --raw to this file

</details>

<a id="hidive-commands-and-options"></a>

## HIDIVE options

<details>
<summary>Show options for <code>--service hidive</code> (HIDIVE)</summary>

Use `--service hidive` before these options. For the full help on your computer, run `aniDL --service hidive --help`.



### Authentication
#### `--username`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| HIDIVE, ADN | `--service hidive --username ${username}` | `string` | `No` | `—` | `undefined` | `username: ` |

Set the username to use for authentication. For Crunchyroll CLI, use --device or --token.
#### `--password`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| HIDIVE, ADN | `--service hidive --password ${password}` | `string` | `No` | `—` | `undefined` | `password: ` |

Set the password to use for authentication. For Crunchyroll CLI, use --device or --token.

### Downloading
#### `--series`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| Crunchyroll, HIDIVE | `--service hidive --series ${ID}` | `string` | `No` | `--srz` | `—` |

Use the numeric series ID for HIDIVE. On Crunchyroll, use the series ID. This supports multiple --dubLang languages and --allDubs. Add -s to select one Crunchyroll season.
#### `--originalFontSize`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll, HIDIVE | `--service hidive --originalFontSize` | `boolean` | `No` | `—` | `true` | `originalFontSize: ` |

If selected, it will prefer to keep the original Font Size defined by the service.
#### `--noASSConv`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll, HIDIVE | `--service hidive --noASSConv` | `boolean` | `No` | `—` | `false` | `noASSConv: ` |

Disables VTT conversion to ASS.
#### `--noaudio`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| Crunchyroll, HIDIVE | `--service hidive --noaudio` | `boolean` | `No` | `—` | `—` |

Skip downloading audio
#### `--combineLines`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| HIDIVE | `--service hidive --combineLines` | `boolean` | `No` | `—` | `—` |

If selected, will prevent a line from shifting downwards
#### `--addArchive`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- |
| Crunchyroll, HIDIVE | `--service hidive --addArchive` | `boolean` | `No` | `—` | `—` |

Crunchyroll accepts either -s for a season or --srz for a series. HIDIVE accepts -s for a season.

### Muxing
#### `--defaultAudio`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| HIDIVE, ADN | `--service hidive --defaultAudio ${args}` | `string` | `No` | `—` | `eng` | `defaultAudio: ` |

Set the default audio track by language code for other providers. Crunchyroll accepts this setting but marks all included tracks Default=yes; audio order follows dubLang, or English then Japanese then other languages by English name with allDubs.
Possible Values: und, eng, eng, spa, spa-419, spa-ES, por, por, fra, deu, ara-ME, ara, ita, rus, tur, hin, cmn, zho, chi, zh-HK, kor, cat, pol, tha, tam, may, vie, ind, tel, jpn
#### `--defaultSub`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| HIDIVE, ADN | `--service hidive --defaultSub ${args}` | `string` | `No` | `—` | `eng` | `defaultSub: ` |

Set the default subtitle track by language code for other providers. Crunchyroll accepts this setting but marks all included tracks Default=yes; audio order follows dubLang, or English then Japanese then other languages by English name with allDubs.
Possible Values: und, eng, eng, spa, spa-419, spa-ES, por, por, fra, deu, ara-ME, ara, ita, rus, tur, hin, cmn, zho, chi, zh-HK, kor, cat, pol, tha, tam, may, vie, ind, tel, jpn

</details>

<a id="adn-commands-and-options"></a>

## ADN options

<details>
<summary>Show options for <code>--service adn</code> (ADN)</summary>

Use `--service adn` before these options. For the full help on your computer, run `aniDL --service adn --help`.



### Authentication
#### `--username`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| HIDIVE, ADN | `--service adn --username ${username}` | `string` | `No` | `—` | `undefined` | `username: ` |

Set the username to use for authentication. For Crunchyroll CLI, use --device or --token.
#### `--password`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| HIDIVE, ADN | `--service adn --password ${password}` | `string` | `No` | `—` | `undefined` | `password: ` |

Set the password to use for authentication. For Crunchyroll CLI, use --device or --token.

### Search
#### `--locale`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll, ADN | `--service adn --locale ${locale}` | `string` | `No` | `—` | [`''`, `und`, `en-US`, `en-IN`, `es-LA`, `es-419`, `es-ES`, `pt-BR`, `pt-PT`, `fr-FR`, `de-DE`, `ar-ME`, `ar-SA`, `it-IT`, `ru-RU`, `tr-TR`, `hi-IN`, `zh-CN`, `zh-TW`, `zh-HK`, `ko-KR`, `ca-ES`, `pl-PL`, `th-TH`, `ta-IN`, `ms-MY`, `vi-VN`, `id-ID`, `te-IN`, `und`, `fr`, `de`, `pl`] | `en-US` | `locale: ` |

Set the local that will be used for the API.

### Downloading
#### `--dlVideoOnce`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll, ADN | `--service adn --dlVideoOnce` | `boolean` | `No` | `—` | `false` | `dlVideoOnce: ` |

On ADN, request the best selected video quality once and use the lowest video quality for later dubs. On Crunchyroll, download video once for per-language DASH downloads. Combined HLS downloads may include lower-quality video with later audio tracks. Global Crunchyroll DASH selection already shares one video. --keepAllVideos retains downloaded video tracks.
#### `--chapters`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll, ADN | `--service adn --chapters` | `boolean` | `No` | `—` | `true` | `chapters: ` |

Will fetch the chapters and add them into the final video.
#### `--waittime`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll, ADN | `--service adn --waittime ${waittime}` | `number` | `No` | `—` | `0` | `waittime: ` |

Set the wait between downloads in milliseconds

### Muxing
#### `--keepAllVideos`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll, ADN | `--service adn --keepAllVideos` | `boolean` | `No` | `—` | `false` | `keepAllVideos: ` |

If set to true, it will keep all videos in the merge process, rather than discarding the extra videos.
#### `--syncTiming`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| Crunchyroll, ADN | `--service adn --syncTiming` | `boolean` | `No` | `—` | `false` | `syncTiming: ` |

If enabled attempts to sync timing for multi-dub downloads.
NOTE: This is currently experimental and syncs audio and subtitles, though subtitles has a lot of guesswork
If you find bugs with this, please report it in the discord or github
#### `--defaultAudio`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| HIDIVE, ADN | `--service adn --defaultAudio ${args}` | `string` | `No` | `—` | `eng` | `defaultAudio: ` |

Set the default audio track by language code for other providers. Crunchyroll accepts this setting but marks all included tracks Default=yes; audio order follows dubLang, or English then Japanese then other languages by English name with allDubs.
Possible Values: und, eng, eng, spa, spa-419, spa-ES, por, por, fra, deu, ara-ME, ara, ita, rus, tur, hin, cmn, zho, chi, zh-HK, kor, cat, pol, tha, tam, may, vie, ind, tel, jpn
#### `--defaultSub`

| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Default** | **cli-default Entry** |
| --- | --- | --- | --- | --- | --- | --- |
| HIDIVE, ADN | `--service adn --defaultSub ${args}` | `string` | `No` | `—` | `eng` | `defaultSub: ` |

Set the default subtitle track by language code for other providers. Crunchyroll accepts this setting but marks all included tracks Default=yes; audio order follows dubLang, or English then Japanese then other languages by English name with allDubs.
Possible Values: und, eng, eng, spa, spa-419, spa-ES, por, por, fra, deu, ara-ME, ara, ita, rus, tur, hin, cmn, zho, chi, zh-HK, kor, cat, pol, tha, tam, may, vie, ind, tel, jpn

</details>

[Back to the CLI walkthrough](GET-STARTED.md)
