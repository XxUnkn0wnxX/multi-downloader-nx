# multi-downloader-nx (v5.8.8)

If you find any bugs in this documentation or in the program itself, please report them on [GitHub issues](../../../issues).

## Legal Warning

This application is not endorsed by or affiliated with *Crunchyroll*, *Hidive* or *AnimationDigitalNetwork*.
This application enables you to download videos for offline viewing which may be forbidden by law in your country.
The usage of this application may also cause a violation of the *Terms of Service* between you and the stream provider.
This tool is not responsible for your actions; please make an informed decision before using this application.

## CLI Options
### Legend
 - `${someText}` shows that you should replace this text with your own
    - e.g. `--username ${someText}` -> `--username Izuco`

Quality-list rates use decimal `kb/s` (1 kb/s = 1,000 bits/s). `KiB/s` measures 1,024 bytes/s. Manifest bandwidth is an advertised rate and may differ from a file's measured average.

### Authentication
#### `--auth`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| All | `--auth ` | `boolean` | `No`| `—` | `—` |

Most of the shows on both services are only accessible if you payed for the service.
In order for them to know who you are you are required to log in.
For Crunchyroll CLI use --device instead. Other services prompt for a username and password.
#### `--device`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--device ` | `boolean` | `No`| `—` | `—` |

Log in to Crunchyroll with an activation code. The CLI prints the URL and code, waits for browser approval, and saves the device session for automatic refresh.
#### `--username`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--username ${username}` | `string` | `No`| `—` | `undefined`| `username: ` |

Set the username to use for authentication. For Crunchyroll CLI login, use --device instead.
#### `--password`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--password ${password}` | `string` | `No`| `—` | `undefined`| `password: ` |

Set the password to use for authentication. For Crunchyroll CLI login, use --device instead.
#### `--silentAuth`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--silentAuth ` | `boolean` | `No`| `—` | `false`| `silentAuth: ` |

Crunchyroll CLI password login is unavailable. Use --device instead.
#### `--token`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--token ${token}` | `string` | `No`| `—` | `undefined`| `token: ` |

Log in to Crunchyroll with the UUID-shaped etp_rt cookie value (optionally prefixed with etp_rt=), or the path to a file containing the raw token or a Netscape cookies export. The file may have any name or extension.
### Fonts
#### `--dlFonts`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--dlFonts ` | `boolean` | `No`| `—` | `—` |

Crunchyroll uses a variaty of fonts for the subtitles.
Use this command to download all the fonts and add them to the muxed **mkv** file.
#### `--fontName`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| Hidive, AnimationDigitalNetwork | `--fontName ${fontName}` | `string` | `No`| `—` | `—` |

Set the font to use in subtiles
### Search
#### `--search`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| All | `--search ${search}` | `string` | `No`| `-f` | `—` |

Search of an anime by the given string
#### `--search-type`
| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--search-type ${type}` | `string` | `No`| `—` | [`''`, `top_results`, `series`, `movie_listing`, `episode`] | ``| `search-type: ` |

Search only for type of anime listings (e.g. episodes, series)
#### `--page`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| Crunchyroll, Hidive | `--page ${page}` | `number` | `No`| `-p` | `—` |

The output is organized in pages. Use this command to output the items for the given page
#### `--locale`
| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll, AnimationDigitalNetwork | `--locale ${locale}` | `string` | `No`| `—` | [`''`, `und`, `en-US`, `en-IN`, `es-LA`, `es-419`, `es-ES`, `pt-BR`, `pt-PT`, `fr-FR`, `de-DE`, `ar-ME`, `ar-SA`, `it-IT`, `ru-RU`, `tr-TR`, `hi-IN`, `zh-CN`, `zh-TW`, `zh-HK`, `ko-KR`, `ca-ES`, `pl-PL`, `th-TH`, `ta-IN`, `ms-MY`, `vi-VN`, `id-ID`, `te-IN`, `und`, `fr`, `de`, `pl`] | `en-US`| `locale: ` |

Set the local that will be used for the API.
#### `--new`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| Crunchyroll, Hidive | `--new ` | `boolean` | `No`| `—` | `—` |

Get last updated series list
### Downloading
#### `--absolute`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--absolute ` | `boolean` | `No`| `—` | `—` |

Use absolute numbers for the episode. If not set, it will use the default index numbers
#### `--movie-listing`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--movie-listing ${ID}` | `string` | `No`| `--flm` | `—` |

Get video list by Movie Listing ID
#### `--show-raw`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--show-raw ${ID}` | `string` | `No`| `--sraw` | `—` |

Get Raw Show data
#### `--season-raw`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--season-raw ${ID}` | `string` | `No`| `--seraw` | `—` |

Get Raw Season data
#### `--show-list-raw`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--show-list-raw ` | `boolean` | `No`| `--slraw` | `—` |

Get Raw Show list data
#### `--series`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--series ${ID}` | `string` | `No`| `--srz` | `—` |

Requested is the ID of a show not a season.
#### `-s`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| All | `-s ${ID}` | `string` | `No`| `—` | `—` |

Used to set the season ID to download from
#### `-e`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| All | `-e ${selection}` | `string` | `No`| `--episode` | `—` |

Set the episode(s) to download from any given show.
For multiple selection: 1-4 OR 1,2,3,4 
For special episodes: S1-4 OR S1,S2,S3,S4 where S is the special letter
#### `--extid`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--extid ${selection}` | `string` | `No`| `--externalid` | `—` |

Set the external id to lookup/download.
Allows you to download or view legacy Crunchyroll Ids 
#### `-q`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `-q ${qualityLevel}` | `number` | `No`| `—` | `0`| `q: ` |

Use the listed quality number; 0 selects the maximum quality. Crunchyroll ranks by dimensions, then advertised bitrate, and compares compatible current and legacy video across languages while keeping the highest current audio for the requested dubs. Crunchyroll reports a short reason when checks force video fallback. Its quality list uses resolution groups with continuous numbers and short manifest and video-source language tags such as [V:jpn], marking the selected row. Its audio quality list uses independent [A:eng] language tags and shows the selected audio server below the row. A fallback prints only the discarded and re-selected rows, when applicable.
#### `--dlVideoOnce`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--dlVideoOnce ` | `boolean` | `No`| `—` | `false`| `dlVideoOnce: ` |

For per-language DASH downloads, download video once. Combined HLS downloads may include lower-quality video with later audio tracks. Global Crunchyroll DASH selection already shares one video. --keepAllVideos retains downloaded video tracks.
#### `--chapters`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll, AnimationDigitalNetwork | `--chapters ` | `boolean` | `No`| `—` | `true`| `chapters: ` |

Will fetch the chapters and add them into the final video.
#### `--removeBumpers`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Hidive | `--removeBumpers ` | `boolean` | `No`| `—` | `true`| `removeBumpers: ` |

If selected, it will remove the bumpers such as the hidive intro from the final file.
Currently disabling this sometimes results in bugs such as video/audio desync
#### `--originalFontSize`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Hidive | `--originalFontSize ` | `boolean` | `No`| `—` | `true`| `originalFontSize: ` |

If selected, it will prefer to keep the original Font Size defined by the service.
#### `-x`
| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | --- | ---|
| All | `-x ${server}` | `number` | `No`| `--server` | [`1`, `2`, `3`, `4`] | `1`| `x: ` |

Select the server to use
#### `--cstream`
| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--cstream ${device}` | `string` | `No`| `--cs` | [`androidtv`, `android`, `androidtab`, `chrome`, `firefox`, `none`] | `—` |

(Please use --vstream and --astream instead, this will deprecate soon)
#### `--vstream`
| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--vstream ${device}` | `string` | `No`| `--vs` | [`androidtv`, `android`, `androidtab`, `chrome`, `firefox`, `none`] | `androidtv`| `vstream: ` |

Select a specific Crunchyroll video playback endpoint by device. Availability and quality depend on the service.
#### `--astream`
| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--astream ${device}` | `string` | `No`| `--as` | [`androidtv`, `android`, `androidtab`, `chrome`, `firefox`, `none`] | `android`| `astream: ` |

Select a specific Crunchyroll audio playback endpoint by device. Available renditions and bitrate depend on the service, account, and episode.
#### `--tsd`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--tsd ` | `boolean` | `No`| `—` | `false`| `tsd: ` |

(Total Session Death) Kills all active Crunchyroll Streaming Sessions to prevent getting the "TOO_MANY_ACTIVE_STREAMS" error.
#### `--hslang`
| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--hslang ${hslang}` | `string` | `No`| `—` | [`none`, `un`, `en`, `en-IN`, `es-419`, `es-ES`, `pt-BR`, `pt-PT`, `fr`, `de`, `ar`, `it`, `ru`, `tr`, `hi`, `zh`, `zh-CN`, `zh-TW`, `zh-HK`, `ko`, `ca-ES`, `pl-PL`, `th-TH`, `ta-IN`, `ms-MY`, `vi-VN`, `id-ID`, `te-IN`, `ja`] | `none`| `hslang: ` |

Download video with specific hardsubs
#### `--dlsubs`
| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | --- | ---|
| All | `--dlsubs ${sub1} ${sub2}` | `array` | `No`| `—` | [`all`, `none`, `un`, `en`, `en-IN`, `es-419`, `es-ES`, `pt-BR`, `pt-PT`, `fr`, `de`, `ar`, `it`, `ru`, `tr`, `hi`, `zh`, `zh-CN`, `zh-TW`, `zh-HK`, `ko`, `ca-ES`, `pl-PL`, `th-TH`, `ta-IN`, `ms-MY`, `vi-VN`, `id-ID`, `te-IN`, `ja`] | `all`| `dlsubs: ` |

Download subtitles by language tag (space-separated)
Crunchy Only: un, en, en-IN, es-419, es-419, es-ES, pt-BR, pt-PT, fr, de, ar, ar, it, ru, tr, hi, zh-CN, zh-TW, zh-HK, ko, ca-ES, pl-PL, th-TH, ta-IN, ms-MY, vi-VN, id-ID, te-IN, ja
#### `--skipMuxOnSubFail`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--skipMuxOnSubFail ` | `boolean` | `No`| `—` | `false`| `skipMuxOnSubFail: ` |

Skips muxing when a subtitle download fails.
#### `--noASSConv`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll, Hidive | `--noASSConv ` | `boolean` | `No`| `—` | `false`| `noASSConv: ` |

Disables VTT conversion to ASS.
#### `--noSubFix`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--noSubFix ` | `boolean` | `No`| `—` | `false`| `noSubFix: ` |

Disables all subtitle fixes and downloads raw subtitles.
#### `--srtAssFix`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--srtAssFix ` | `boolean` | `No`| `—` | `true`| `srtAssFix: ` |

Fixes the recently changed Crunchyroll subtitles provided by Closed Caption Converter.
#### `--layoutResFix`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--layoutResFix ` | `boolean` | `No`| `—` | `true`| `layoutResFix: ` |

Applies the LayoutRes Fix to all ASS subtitles.
#### `--scaledBorderAndShadowFix`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--scaledBorderAndShadowFix ` | `boolean` | `No`| `—` | `true`| `scaledBorderAndShadowFix: ` |

Applies the ScaledBorderAndShadow Fix to all ASS subtitles.
#### `--scaledBorderAndShadow`
| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--scaledBorderAndShadow ${yes/no}` | `string` | `No`| `—` | [`yes`, `no`] | `yes`| `scaledBorderAndShadow: ` |

Select if ScaledBorderAndShadow should be set to "yes" or "no".
#### `--originalScriptFix`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--originalScriptFix ` | `boolean` | `No`| `—` | `true`| `originalScriptFix: ` |

Removes the URL in the Original Script line of the ASS subtitles, it prevents from bricking the subs in VLC (Fonts not loading when url not returning 200).
#### `--subtitleTimestampFix`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--subtitleTimestampFix ` | `boolean` | `No`| `—` | `false`| `subtitleTimestampFix: ` |

Fixes subtitle dialogues that go over the video length (deletes dialogues where start is over video length and updates the end timestamp when end is over video length).
#### `--forcevideo`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll | `--forcevideo ` | `boolean` | `No`| `--forcevid` | `false`| `forcevideo: ` |

Bypass cross-language video timing checks. May cause audio/video desync. Not needed with --noaudio; subtitle timings are never used.
#### `--dry-run`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--dry-run ` | `boolean` | `No`| `--dryRun` | `false`| `dry-run: ` |

Preview available qualities and stream URLs without downloading files. Authentication and token refresh still run.
#### `--novids`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| All | `--novids ` | `boolean` | `No`| `—` | `—` |

Skip downloading videos
#### `--noaudio`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| Crunchyroll, Hidive | `--noaudio ` | `boolean` | `No`| `—` | `—` |

Skip downloading audio
#### `--nosubs`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| All | `--nosubs ` | `boolean` | `No`| `—` | `—` |

Skip downloading subtitles
#### `--dubLang`
| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | --- | ---|
| All | `--dubLang ${dub1} ${dub2}` | `array` | `No`| `—` | [`und`, `eng`, `spa`, `spa-419`, `spa-ES`, `por`, `fra`, `deu`, `ara-ME`, `ara`, `ita`, `rus`, `tur`, `hin`, `cmn`, `zho`, `chi`, `zh-HK`, `kor`, `cat`, `pol`, `tha`, `tam`, `may`, `vie`, `ind`, `tel`, `jpn`] | `jpn`| `dubLang: ` |

Set the language to download: 
Crunchy Only: und, eng, eng, spa, spa-419, spa-ES, por, por, fra, deu, ara-ME, ara, ita, rus, tur, hin, zho, chi, zh-HK, kor, cat, pol, tha, tam, may, vie, ind, tel, jpn
#### `--all`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--all ` | `boolean` | `No`| `—` | `false`| `all: ` |

Used to download all episodes from the show
#### `--fontSize`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--fontSize ${fontSize}` | `number` | `No`| `—` | `55`| `fontSize: ` |

When converting the subtitles to ass, this will change the font size
In most cases, requires "--originaFontSize false" to take effect
#### `--combineLines`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| Hidive | `--combineLines ` | `boolean` | `No`| `—` | `—` |

If selected, will prevent a line from shifting downwards
#### `--allDubs`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| All | `--allDubs ` | `boolean` | `No`| `—` | `—` |

If selected, all available dubs will get downloaded
#### `--timeout`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--timeout ${timeout}` | `number` | `No`| `—` | `15000`| `timeout: ` |

Set the timeout of all download reqests. Set in millisecods
#### `--waittime`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll, Hidive | `--waittime ${waittime}` | `number` | `No`| `—` | `0`| `waittime: ` |

Set the time the program waits between downloads. Set in millisecods
#### `--simul`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Hidive | `--simul ` | `boolean` | `No`| `—` | `false`| `simul: ` |

Force downloading simulcast version instead of uncut version (if available).
#### `--but`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| All | `--but ` | `boolean` | `No`| `—` | `—` |

Download everything but the -e selection
#### `--downloadArchive`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| All | `--downloadArchive ` | `boolean` | `No`| `—` | `—` |

Used to download all archived shows
#### `--addArchive`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| All | `--addArchive ` | `boolean` | `No`| `—` | `—` |

Used to add the `-s` and `--srz` to downloadArchive
#### `--partsize`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--partsize ${amount}` | `number` | `No`| `—` | `10`| `partsize: ` |

Set the amount of parts to download at once
If you have a good connection try incresing this number to get a higher overall speed
#### `--fsRetryTime`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--fsRetryTime ${time in seconds}` | `number` | `No`| `—` | `5`| `fsRetryTime: ` |

Set the time the downloader waits before retrying if an error while writing the file occurs
#### `--force`
| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--force ${option}` | `string` | `No`| `—` | [`y`, `Y`, `n`, `N`, `c`, `C`] | `—` |

If a file already exists, the tool will ask you how to proceed. With this, you can answer in advance.
### Muxing
#### `--mp4`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--mp4 ` | `boolean` | `No`| `—` | `false`| `mp4: ` |

If selected, the output file will be an mp4 file (not recommended tho)
#### `--keepAllVideos`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll, Hidive | `--keepAllVideos ` | `boolean` | `No`| `—` | `false`| `keepAllVideos: ` |

If set to true, it will keep all videos in the merge process, rather than discarding the extra videos.
#### `--syncTiming`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| Crunchyroll, Hidive | `--syncTiming ` | `boolean` | `No`| `—` | `false`| `syncTiming: ` |

If enabled attempts to sync timing for multi-dub downloads.
NOTE: This is currently experimental and syncs audio and subtitles, though subtitles has a lot of guesswork
If you find bugs with this, please report it in the discord or github
#### `--skipmux`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| All | `--skipmux ` | `boolean` | `No`| `—` | `—` |

Skip muxing video, audio and subtitles
#### `--nocleanup`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--nocleanup ` | `boolean` | `No`| `—` | `false`| `nocleanup: ` |

Don't delete subtitle, audio and video files after muxing
#### `--skipSubMux`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--skipSubMux ` | `boolean` | `No`| `—` | `false`| `skipSubMux: ` |

Skip muxing the subtitles
#### `--forceMuxer`
| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | --- | ---|
| All | `--forceMuxer ${muxer}` | `string` | `No`| `—` | [`ffmpeg`, `mkvmerge`] | `undefined`| `forceMuxer: ` |

Force the program to use said muxer or don't mux if the given muxer is not present
#### `--videoTitle`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| All | `--videoTitle ${title}` | `string` | `No`| `—` | `—` |

Set the video track name of the merged file
#### `--mkvmergeOptions`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--mkvmergeOptions ${args}` | `array` | `No`| `—` | `--no-date,--disable-track-statistics-tags,--engage no_variable_data`| `mkvmergeOptions: ` |

Set the options given to mkvmerge
#### `--ffmpegOptions`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--ffmpegOptions ${args}` | `array` | `No`| `—` | ``| `ffmpegOptions: ` |

Set the options given to ffmpeg
#### `--defaultAudio`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--defaultAudio ${args}` | `string` | `No`| `—` | `eng`| `defaultAudio: ` |

Set the default audio track by language code
Possible Values: und, eng, eng, spa, spa-419, spa-ES, por, por, fra, deu, ara-ME, ara, ita, rus, tur, hin, cmn, zho, chi, zh-HK, kor, cat, pol, tha, tam, may, vie, ind, tel, jpn
#### `--defaultSub`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--defaultSub ${args}` | `string` | `No`| `—` | `eng`| `defaultSub: ` |

Set the default subtitle track by language code
Possible Values: und, eng, eng, spa, spa-419, spa-ES, por, por, fra, deu, ara-ME, ara, ita, rus, tur, hin, cmn, zho, chi, zh-HK, kor, cat, pol, tha, tam, may, vie, ind, tel, jpn
### Filename Template
#### `--fileName`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--fileName ${fileName}` | `string` | `No`| `—` | `[${service}] ${showTitle} - S${season}E${episode} [${height}p]`| `fileName: ` |

Set the filename template. Use ${variable_name} to insert variables.
You can also create folders by inserting a path seperator in the filename
You may use 'title', 'episode', 'showTitle', 'seriesTitle', 'season', 'width', 'height', 'service' as variables.
#### `--numbers`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--numbers ${number}` | `number` | `No`| `—` | `2`| `numbers: ` |

Set how long a number in the title should be at least.
Set in config: 3; Episode number: 5; Output: 005
Set in config: 2; Episode number: 1; Output: 01
Set in config: 1; Episode number: 20; Output: 20
#### `--override`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--override "${toOverride}='${value}'"` | `array` | `No`| `—` | ``| `override: ` |

Override a template variable
#### `--ccTag`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--ccTag ${tag}` | `string` | `No`| `—` | `cc`| `ccTag: ` |

Used to set the name for subtitles that contain tranlations for none verbal communication (e.g. signs)
### Debug
#### `--nosess`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--nosess ` | `boolean` | `No`| `—` | `false`| `nosess: ` |

Reset session cookie for testing purposes
#### `--debug`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--debug ` | `boolean` | `No`| `—` | `false`| `debug: ` |

Debug mode (tokens may be revealed in the console output)
### Utilities
#### `--service`
| **Service** | **Usage** | **Type** | **Required** | **Alias** | **Choices** | **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | --- | ---|
| All | `--service ${service}` | `string` | `Yes`| `—` | [`crunchy`, `hidive`, `adn`] | ``| `service: ` |

Set the service you want to use
#### `--update`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| All | `--update ` | `boolean` | `No`| `—` | `—` |

Force the tool to check for updates (code version only)
#### `--skipUpdate`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--skipUpdate ` | `boolean` | `No`| `—` | `false`| `skipUpdate: ` |

If true, the tool won't check for updates
#### `--raw`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--raw ` | `boolean` | `No`| `—` | `false`| `raw: ` |

If true, the tool will output the raw data from the API (Where applicable, the feature is a WIP)
#### `--rawoutput`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--rawoutput ` | `string` | `No`| `—` | ``| `rawoutput: ` |

Provide a path to output the raw data from the API into a file (Where applicable, the feature is a WIP)
#### `--proxy`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--proxy ${proxy_url}` | `string` | `No`| `—` | ``| `proxy: ` |

Uses Proxy on geo-restricted or geo-defining endpoints (e.g. `https://127.0.0.1:1080` or `http://127.0.0.1:1080`)
#### `--proxyAll`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **Default** |**cli-default Entry**
| --- | --- | --- | --- | --- | --- | ---|
| All | `--proxyAll ` | `boolean` | `No`| `—` | `false`| `proxyAll: ` |

Proxies everything, not recommended. Proxy needs to be defined.
### Help
#### `--help`
| **Service** | **Usage** | **Type** | **Required** | **Alias** |  **cli-default Entry**
| --- | --- | --- | --- | --- | ---|
| All | `--help ` | `boolean` | `No`| `-h` | `—` |

Show the help output