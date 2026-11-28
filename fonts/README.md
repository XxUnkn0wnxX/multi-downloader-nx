# 🔤 Subtitle fonts

Keep `fonts/` beside the AniDL executable when you extract the CLI archive. Rev8 includes 31 subtitle fonts. When saving an MKV, AniDL can attach the fonts it recognizes in your selected ASS subtitles so your player can use them.

**(Crunchyroll only)** AniDL tries to download missing catalog fonts when saving an MKV and keeps them for the next download. If a font is unavailable, AniDL names it and continues. To fetch the full catalog in advance, use [`--dlFonts`](../docs/ARGUMENTS.md#--dlfonts). HIDIVE and ADN use fonts already in your configured folder.

To use another folder, set `fonts` in `config/dir-path.yml` to its absolute path. If you use `dir-path.user.yml`, edit that file instead. AniDL looks for catalog filenames such as `Rubik-Regular.ttf` in the folder you choose. Copy the bundled files there as well if you want to keep using them.

## Included fonts and licenses

Keep these notices with the font files if you redistribute them.

| Included fonts | Upstream project and bundled version | License |
| --- | --- | --- |
| DejaVu Sans, Sans Condensed, Sans Mono and LGC Sans Mono | [DejaVu 2.30](https://github.com/dejavu-fonts/dejavu-fonts/tree/version_2_30/dejavu-fonts) | [DejaVu license](DejaVu-LICENSE.txt) |
| Meera Inimai | [Meera Inimai 2.0.0+20160526](https://github.com/google/fonts/tree/30dc4b94a063ec101231e07dad13a8446ac5b9aa/ofl/meerainimai) | [SIL Open Font License](OFL.txt) |
| Noto Sans Tamil, Telugu and Thai | [Tamil 2.004](https://github.com/notofonts/tamil/releases/tag/NotoSansTamil-v2.004), [Telugu 2.005](https://github.com/notofonts/telugu/releases/tag/NotoSansTelugu-v2.005), [Thai 2.001](https://github.com/notofonts/thai/releases/tag/NotoSansThai-v2.001) | [SIL Open Font License](OFL.txt) |
| Rubik | [Rubik 1.002](https://github.com/google/fonts/tree/be05a79abd69/ofl/rubik) | [SIL Open Font License](OFL.txt) |

[Back to defaults and output paths](../docs/GET-STARTED.md#set-defaults-and-output-paths)
