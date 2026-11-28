# 🔤 Subtitle fonts

Keep `fonts/` beside the AniDL executable when you extract the archive. When muxing an MKV, AniDL attaches the available fonts referenced by your ASS subtitles.

To use your own collection, set `fonts` in `config/dir-path.yml` to the absolute path of that folder. For a Crunchyroll MKV, AniDL tries to fetch any missing fonts it recognizes from the selected subtitles. It warns about fonts it could not fetch and continues muxing. To download the full Crunchyroll catalog in advance, use [`--dlFonts` **(Crunchyroll only)**](../docs/ARGUMENTS.md#--dlfonts).

## Included fonts and licenses

Keep these notices with the font files if you redistribute them.

| Included fonts | Source and version | License |
| --- | --- | --- |
| DejaVu Sans, Sans Condensed, Sans Mono and LGC Sans Mono | [DejaVu 2.30](https://github.com/dejavu-fonts/dejavu-fonts/tree/version_2_30/dejavu-fonts) | [DejaVu license](DejaVu-LICENSE.txt) |
| Meera Inimai | [Meera Inimai 2.0.0](https://github.com/google/fonts/tree/main/ofl/meerainimai) | [SIL Open Font License](OFL.txt) |
| Noto Sans Tamil, Telugu and Thai | [Tamil 2.004](https://github.com/notofonts/tamil), [Telugu 2.005](https://github.com/notofonts/telugu), [Thai 2.001](https://github.com/notofonts/thai) | [SIL Open Font License](OFL.txt) |
| Rubik | [Rubik 1.002](https://github.com/google/fonts/tree/be05a79abd69/ofl/rubik) | [SIL Open Font License](OFL.txt) |

[Back to defaults and output paths](../docs/GET-STARTED.md#set-defaults-and-output-paths)
