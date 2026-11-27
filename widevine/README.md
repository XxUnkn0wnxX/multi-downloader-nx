# 🔑 CDM setup

For encrypted streams, AniDL needs device files for a content decryption module (CDM). Supply your own files. The folders below are beside the AniDL executable.

| If you have… | Place these files in… |
| --- | --- |
| A Widevine `.wvd` file | `widevine/` |
| A Widevine file pair | `widevine/` — both `client_id.bin` and `private_key.pem`, or both `device_client_id_blob` and `device_private_key` |
| A PlayReady `.prd` file | `playready/` |
| A PlayReady file pair | `playready/` — both `bgroupcert.dat` and `zgpriv.dat` |

AniDL supports PlayReady security levels SL2000 and SL3000.

## 🔑 Widevine keys

If you need a Widevine L3 client ID and matching private key, set up and use [Dumper](https://github.com/XxUnkn0wnxX/dumper).

Follow its [setup guide](https://github.com/XxUnkn0wnxX/dumper/blob/main/docs/setup.md) for dependencies and instructions. A supported, root-capable Android device or emulator is required.
