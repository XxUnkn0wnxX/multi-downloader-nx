# Crunchyroll playback recovery

Crunchyroll playback can be refused even when an earlier session appears to have ended. AniDL's automatic refusal-retry flow starts only after a fully received HTTP 429 response whose JSON error is exactly `4294` with reason `Too many requests`. Other errors, incomplete responses, uncertain acquisitions, cancellation, or failed session cleanup stop that flow. Explicit resets and enabled episode preflight checks are separate modes. Automatic recovery is bounded and is not a guaranteed rate-limit bypass.

## Episode capacity checks

Enable `--tsd` or set `tsd: true` in `config/cli-defaults.yml` to check capacity before every episode, including a single episode and a preview. Without `tsd`, normal downloads do not make proactive session-list or capacity requests, though an exact qualifying playback refusal still triggers a read-only capacity assessment as part of bounded recovery.

AniDL compares a validated active-session count with the account's `concurrent_streams.N` benefit. This is a client-side capacity assessment, not a free-slot value reported by Crunchyroll. Missing, malformed, conflicting, or incomplete information is unknown and never authorizes an account-wide clear.

- **Capacity available:** continue without clearing sessions.
- **Capacity full and the command clear allowance is unused:** close the validated session list, then verify that no sessions remain. Only one account-wide clear is allowed across the whole command, including archive entries.
- **Capacity full after that allowance is used:** wait for a slot without deleting sessions.
- **Capacity unknown:** never clear sessions. A normal preflight continues without clearing; after a qualifying refusal, use only the remaining ordinary retry allowance.

Slot checks poll about every five seconds for up to 60 seconds. A newly available slot resumes the operation early, subject to any still-applicable `Retry-After`. If all slots remain full at the deadline, the operation stops without starting another retry cycle. If a slot-list poll fails or returns unknown data, treat capacity as unknown and use only the remaining ordinary retry allowance; do not restart the 60-second polling interval. Failed session cleanup or a failed zero-verification after clearing is terminal.

## Read-only playback status

Use `--check-status` to inspect current capacity and the latest recorded wait without starting playback or clearing sessions:

```sh
aniDL --service crunchy --check-status
```

This is a CLI-only action; only `--service crunchy` and optional `--debug` may accompany it. Config cannot enable it. It requires an existing saved login and performs the normal token refresh first, which may take additional time. The single status snapshot is bounded to 15 seconds after refresh. It does not acquire playback/download sessions, run recovery, or delete sessions.

The result reports the concurrent-stream allowance, active session count and calculated available slots when known. Partial known values remain visible if another lookup fails; missing or incomplete fields are unknown, never zero. An incomplete snapshot returns failure after partial output. Status lookup HTTP results and any valid `Retry-After` are reported separately from the historical playback wait. Missing current rate-limit metadata does not prove there is no limit.

The recorded playback wait comes from an earlier playback refusal and is local, account-bound, informational data. An active wait is rounded up and displayed as seconds below one minute, `MM:SS` below one hour, or `HH:MM:SS` from one hour (hours can exceed 24). Its suggested retry uses local time in `DD:MM:YYYY - HH:MM:SS` format. An expired or absent record is reported as elapsed or not recorded, with current playback unverified; the default output does not show a raw observation timestamp. Current status-request `Retry-After` values use the same duration format, including in debug stage output. The command does not verify whether playback is currently allowed because it does not start playback. Concurrent local updates are best effort. The record does not authorize resets or change automatic recovery. A historical cooldown alone does not make a successful capacity snapshot fail.

## Explicit standalone reset

To force a reset regardless of reported capacity, pass the standalone CLI flag with no episode, selector, or other action:

```sh
aniDL --service crunchy --tsd
```

This obtains the initial validated session list, closes those sessions, then makes a final verification request. It requires an existing saved login and reports confirmed closes and any sessions remaining. A nonzero or unknown remaining count is a failure. `--dry-run` and `--debug` do not change this explicit command into a preview or disable the reset. A configured `tsd: true` enables episode checks but does not make a bare service command force-clear sessions.

The standalone reset and conditional episode checks are separate modes. Use the standalone form only when you intend to close the listed playback sessions.

## Retry and time limits

Before capacity is assessed after a qualifying refusal, sessions created by the failed acquisition group are closed. If the account is full and `--tsd` is enabled with the shared command clear allowance available, AniDL clears the validated snapshot and verifies zero. Otherwise, a full account uses the bounded slot polling above. Free or unknown capacity uses the ordinary playback retry waits of 10, 30, and 60 seconds. A valid `Retry-After` can lengthen a wait; if the required wait exceeds 60 seconds or the remaining total wait allowance, recovery stops rather than shortening it.

An operation that performs a reset allows at most two acquisition replays; other operations allow at most three. Both share the scheduler's three retry slots. Playback cooldown and slot-poll sleeps share a 120-second allowance. Active work is limited to 90 seconds, for at most 210 seconds of active time plus separately bounded owned-session cleanup. Only actual admitted sleep time extends the active-work deadline. The CLI displays the current retry or slot-wait status and clears its transient indicator when recovery ends.

Manifest discovery has a separate policy: waits of 1, 5, and 20 seconds across three shared retries, with its own 45-second rate-wait budget. Discovery pacing and the `--discovery-timmer` setting do not alter playback recovery limits.

A successful recovery resumes the interrupted discovery source or stream-acquisition step. Completed downloads are not repeated.

Recovery cannot prove that Crunchyroll allocated or released a particular provider-side slot. If a refusal persists, stop and try again later.
