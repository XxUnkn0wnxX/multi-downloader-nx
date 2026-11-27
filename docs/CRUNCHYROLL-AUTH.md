# 🛠️ Crunchyroll sign-in maintenance notes

AniDL keeps separate Crunchyroll sessions for Android phone, Android TV and browser sign-in. If a login stops working, use the checkpoints below to find which step failed and when AniDL can replace the saved session.

For instructions you can follow at the terminal, see the [🔑 Crunchyroll sign-in guide](AUTHENTICATION.md#crunchyroll).

Start Crunchyroll CLI commands with `--service crunchy` and specify the service only once. Run `aniDL --service crunchy --help` to see the Crunchyroll options, or add `--device` or `--token` **(Crunchyroll only)** after the service to open its sign-in help.

| CLI option **(Crunchyroll only)** | Input to check first | Required before saving |
| --- | --- | --- |
| `--device android` | Final address from the Android phone browser sign-in | Matching callback and a successful code exchange with usable tokens and an account ID |
| `--device androidtv` | User code entered on the TV activation page | Provider approval, usable tokens, profile lookup and fresh CMS authorization |
| `--token` | Browser cookie value or cookies file | Successful web-cookie exchange, profile lookup and fresh CMS authorization |

Device sign-in previews **(Crunchyroll only)** show the terminal prompts and then cancel automatically.

```sh
aniDL --service crunchy --device android --dry-run
aniDL --service crunchy --device androidtv --dry-run
```

Phone sign-in builds the authorization link and displays the hidden-paste instructions, then cancels automatically before opening a browser or accepting input. TV sign-in requests a real device code and reports its initial expiry, then cancels automatically before opening the activation page or polling for approval. Neither flow exchanges a token or changes a saved session.

## Android phone callback

The following example shows the URL shape. Both values are placeholders.

```text
https://sso.crunchyroll.com/android/oauth-callback?code=EXAMPLE_CODE&state=ENCODED_STATE
```

- **Address.** AniDL expects the HTTPS origin `https://sso.crunchyroll.com` and the exact path `/android/oauth-callback`. It rejects embedded usernames or passwords, a fragment, and an OAuth `error` parameter.
- **Query.** There must be exactly one `code` and one `state`. The decoded code must contain 1–2,048 printable ASCII characters, excluding spaces. The full pasted address is limited to 8,192 characters.
- **State.** The URL-decoded value must match the state issued for this attempt. AniDL generates it in the form `{"flow":"SIGN_IN","flowRoot":"EXAMPLE_UUID"}`, with a fresh UUID each time. Query order and unrelated extra fields are allowed.
- **Browser and terminal.** A **404 at this callback is harmless**. Copy the entire address from the browser’s address bar, paste once and press Enter. The terminal hides the paste because the address contains a private sign-in code.
- **Exchange.** AniDL sends the code and the verifier from that same attempt to the provider. An address can pass the local checks and still contain an expired or fabricated code. A failed exchange leaves the saved session intact. The phone flow requires a usable access token, refresh token, positive expiry and an account ID before saving.

If sign-in stops **before the browser opens**, check the phone client settings. If it stops **as soon as the address is pasted**, compare the origin, path and query field names with the example above. If the address passes and the **exchange fails**, retry with a fresh browser sign-in and its matching callback. Keep only the URL shape and redacted error details when recording a change. [Phone flow and callback parser](../modules/module.crunchy-phone-auth.ts)

## Android TV approval

1. AniDL requests a code from the device-code endpoint. The response includes a `user_code` to display and a separate `device_code` for polling. The CLI opens and prints `https://crunchyroll.com/activate`. The user enters the displayed code there.
2. AniDL polls the issuer that supplied the code. It reads `expires_in` in **seconds** and `interval` in **milliseconds**. HTTP 204 means approval is pending. The existing fallback can select a different issuer during initiation. Polling stays with that issuer for the whole attempt.
3. After approval, AniDL checks the returned tokens, fetches the profile and requests fresh CMS authorization. Only then does it save the TV session. An expired code needs a new activation attempt. A profile or CMS failure after approval points to a later stage.

If the activation page opens but approval never completes, compare the two code fields, the polling issuer, the time units and the provider’s pending response. [Device-code flow](../modules/module.crunchy-device-auth.ts) · [Provider validation and save](../crunchy.ts)

## Browser cookie inputs

| Input passed to `--token` **(Crunchyroll only)** | Accepted format |
| --- | --- |
| Cookie value | The `etp_rt` value, optionally prefixed with `etp_rt=`. The UUID-shaped value has hexadecimal groups of 8–4–4–4–12 characters. |
| Plain text file | A readable file containing that same value. Surrounding whitespace is allowed. |
| Netscape cookies file | Seven tab-separated fields per cookie row. AniDL looks for `etp_rt` on `crunchyroll.com` or one of its subdomains and recognizes `#HttpOnly_` rows. |

A file can have any name or extension. Quote paths with spaces. For a filename starting with a dash, an explicit path such as `./-cookies.txt` also works. Matching rows with the same cookie value count once. Conflicting valid values stop the import. If no valid matching value is present, the parser reports a missing or malformed cookie and stops before contacting the provider.

After parsing, AniDL exchanges the cookie with Crunchyroll and requires both profile and CMS authorization before saving the web session. For a well-formed cookie that fails to sign in, identify which of those three requests failed. [Cookie input parser](../modules/module.crunchy-token.ts) · [Web sign-in and save](../crunchy.ts)

## Checking a provider change

Compare the first failing stage with the corresponding implementation above. For a changed redirect, record the scheme, host, path and query **names** from a fresh official phone sign-in. Use placeholders for all values. For an activation change, record the field names, time units and response status. For a cookie-format change, reproduce it with a synthetic cookie or export.

Run these checks from the repository root after installing its dependencies.

```sh
node tests/crunchy-token-input.mjs
node tests/crunchy-qall-args.mjs
node tests/crunchy-status-import.mjs
```

The offline fixtures cover callback parsing, provider rejection, TV approval and expiry, cookie imports, and preservation of saved sessions. A fresh sign-in with the affected client confirms current provider behavior. [Auth fixtures](../tests/crunchy-token-input.mjs) · [CLI parser tests](../tests/crunchy-qall-args.mjs) · [Entry-point tests](../tests/crunchy-status-import.mjs) · [Saved session format](../modules/module.crunchy-session-store.ts)

[🛠️ Developer guide](DEVELOPMENT.md) · [Fork changes](fork-changes.md)
