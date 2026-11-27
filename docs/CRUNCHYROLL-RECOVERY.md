# 🔄 Crunchyroll playback recovery

[🚀 Getting started](GET-STARTED.md) · [🔑 Crunchyroll sign-in](AUTHENTICATION.md#crunchyroll) · [📖 CLI options](ARGUMENTS.md)

If Crunchyroll refuses a playback request, start by checking the account's current playback status. AniDL can show the available capacity and any recently recorded wait without starting playback or closing sessions.

[Check status](#read-only-playback-status) · [Check before episodes](#episode-capacity-checks) · [Close active sessions](#explicit-standalone-reset) · [Retry limits](#retry-and-time-limits)

## Read-only playback status

Use `--check-status` **(Crunchyroll only)** with an existing sign-in. Open a terminal in the AniDL folder and run the command for your computer.

<details>
<summary>🪟 Windows — Command Prompt</summary>

```bat
aniDL.exe --service crunchy --check-status
```

</details>

<details>
<summary>🐧 Linux — Terminal</summary>

```sh
./aniDL --service crunchy --check-status
```

</details>

The result can show the account's stream allowance, active sessions, calculated available slots and the latest recorded playback wait. Missing information is shown as **unknown**. A partial lookup can still show the values it found and exits with an error.

- **A slot is available.** If AniDL shows a wait, let it expire first. Then retry your original command. Another viewer may use that capacity before your next request.
- **Capacity is full.** Wait for a viewer to finish, then check again. If you intend to close the listed playback sessions yourself, see [Explicit standalone reset](#explicit-standalone-reset).
- **A playback wait is shown.** Wait until the suggested time, then try your original command again.
- **A value is unknown or the lookup fails.** Try the check again later. AniDL cannot confirm available capacity from incomplete information.

This check refreshes your saved login as needed and then allows up to 15 seconds for the status snapshot. It does not start playback or close sessions. The recorded playback wait comes from an earlier refusal and is stored locally for that account. It is separate from any `Retry-After` reported by the current status request. An available slot or an elapsed earlier wait does not confirm that the next playback request will succeed.

Only `--service crunchy` and optional `--debug` can accompany `--check-status`.

<details>
<summary>Understanding the recorded wait</summary>

An active historical wait is rounded up to seconds below one minute, `MM:SS` below one hour, or `HH:MM:SS` from one hour. The suggested retry uses local time in `DD:MM:YYYY - HH:MM:SS` format. An expired or absent record is shown as elapsed or not recorded. Status-request `Retry-After` values use the same duration format.

The local wait record is informational and best effort. It does not trigger a reset or change automatic recovery. A historical cooldown alone does not make an otherwise successful capacity snapshot fail.

</details>

## Episode capacity checks

Add `--tsd` **(Crunchyroll only)** to check capacity before each episode. **Even a preview with this option can close other viewers’ playback sessions if the account is full.**

This example previews episode 1 of a season. Replace `SEASON_ID` with your own ID and keep any video and audio options your sign-in requires.

<details>
<summary>🪟 Windows — Command Prompt</summary>

```bat
aniDL.exe --service crunchy -s SEASON_ID -e 1 --tsd --dry-run
```

</details>

<details>
<summary>🐧 Linux — Terminal</summary>

```sh
./aniDL --service crunchy -s SEASON_ID -e 1 --tsd --dry-run
```

</details>

If a complete, validated account snapshot shows the capacity is full, AniDL may close the sessions in that snapshot and verify capacity again before continuing. A command can perform at most one account-wide clear, including when processing several episodes or archive entries.

With capacity available, AniDL continues without clearing sessions. When it cannot establish the initial capacity, it continues without clearing. After an intervention, failed or uncertain cleanup or an unknown or still-full verification stops that attempt. If the one-clear allowance has already been used and capacity is full, AniDL waits for a slot instead of clearing again.

You can set `tsd: true` in `config/cli-defaults.yml` to enable the same episode checks for later commands. That setting applies to previews too. Without `--tsd` or the setting, AniDL does not make proactive capacity checks before episodes.

<details>
<summary>How the capacity check works</summary>

AniDL compares the validated active-session count with the account's `concurrent_streams.N` benefit to calculate availability. The provider does not supply a reserved free slot. Missing, malformed, conflicting or incomplete information cannot authorize an account-wide clear.

After a clear, every planned deletion must report success before a fresh complete count is checked. For episode recovery, a verified count below the account limit permits continuation even when it is nonzero. A failed, uncertain or cancelled deletion stops the attempt, as does an unknown or still-full final count. No new playback or download acquisition starts while clearing or verification is pending.

When waiting for capacity, AniDL polls about every five seconds for up to 60 seconds within one shared slot deadline. A verified free slot can end the wait early, subject to any applicable `Retry-After`. Full capacity at the deadline stops the attempt. An unknown poll is not proof of capacity. TSD-owned preflight stops if it cannot verify a slot. After a qualifying refusal, an unknown poll may permit a TSD-owned replay only under the recovery rules below. With TSD off, the remaining ordinary retry policy still applies.

</details>

## Explicit standalone reset

Running `--service crunchy --tsd` **(Crunchyroll only)** without an episode selector closes all listed sessions, **including other viewers’ streams**. Adding `--dry-run` or `--debug` still performs the reset. To see how many sessions are active first, use the [read-only status check](#read-only-playback-status).

<details>
<summary>🪟 Windows — Command Prompt</summary>

```bat
aniDL.exe --service crunchy --tsd
```

</details>

<details>
<summary>🐧 Linux — Terminal</summary>

```sh
./aniDL --service crunchy --tsd
```

</details>

AniDL requires a saved login, closes the listed sessions, then checks again and reports confirmed closes and any remaining sessions. A nonzero or unknown remaining count makes the reset fail.

The standalone command has no episode selector or other action. Setting `tsd: true` alone enables episode checks and does not run a standalone reset.

## Retry and time limits

AniDL attempts automatic playback recovery only after a fully received HTTP 429 response with JSON error `4294` and reason `Too many requests`. It first closes sessions created by the failed acquisition group. Incomplete responses, uncertain acquisitions, cancellation and failed cleanup stop this recovery. A retry may still fail if Crunchyroll continues to refuse playback.

Without a TSD intervention, the ordinary playback retry waits are 10, 30 and 60 seconds, subject to the remaining limits and any valid `Retry-After`. When TSD has intervened for a related acquisition group, AniDL uses the TSD recovery rules and does not switch back to those ordinary waits for the same unresolved problem.

If AniDL stops after its retries or a playback wait remains active, wait and retry your original command later.

<details>
<summary>Detailed recovery and timing limits</summary>

Each TSD-owned replay requires a newly verified recovery event, such as a successful clear followed by verified capacity or a full-to-available slot transition, or a valid `Retry-After` that fits the remaining limits. An unchanged free or unknown snapshot alone does not authorize another replay. A server wait over 60 seconds or beyond the remaining total allowance stops recovery. AniDL checks impossible waits before TSD clearing or polling and again before replay, using the original refusal time.

TSD owns the related acquisition group until all dependent requests succeed. A later independent incident can use the remaining ordinary policy unless TSD intervenes again. Displayed retry numbering may restart for that new incident, but success does not replenish the shared limits. Reset operations allow at most two acquisition replays, other operations at most three, and TSD-owned incidents at most two within those limits. The command-wide account clear remains limited to one.

Playback cooldown and slot-poll sleeps share a 120-second allowance. Each request is bounded to 15 seconds. The scheduler allows 90 seconds of active work normally or 180 seconds for multi-dub discovery or `--qall` **(Crunchyroll only)**. Admitted playback-recovery sleep extends that scheduler window. A whole command may include multiple episodes and other stages.

When AniDL looks up a manifest, it uses cooldowns of 1, 5 and 20 seconds with a 45-second wait budget. Manifest lookups and playback recovery share three retry slots and use smaller request batches between waits. The discovery timer controls normal pacing. Recovery waits still apply when the timer is zero. Overlapping waits use the longer applicable requirement. Downstream manifest and media retries remain available where TSD does not handle a failure.

A successful recovery resumes the interrupted discovery or acquisition step. Completed downloads are not repeated. These checks cannot guarantee that Crunchyroll has reserved a slot or removed a rate limit.

</details>

[Back to the playback status walkthrough](GET-STARTED.md#check-crunchyroll-playback-status)
