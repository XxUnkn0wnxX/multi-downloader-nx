# Crunchyroll playback recovery

Crunchyroll playback can be refused even when an earlier session appears to have ended. AniDL's automatic refusal-retry flow starts only after a fully received HTTP 429 response whose JSON error is exactly `4294` with reason `Too many requests`. Other errors, incomplete responses, uncertain acquisitions, cancellation, or failed session cleanup stop that flow. Explicit resets and enabled episode preflight checks are separate modes. Automatic recovery is bounded and is not a guaranteed rate-limit bypass.

## Episode capacity checks

Enable `--tsd` or set `tsd: true` in `config/cli-defaults.yml` to check capacity before every episode, including a single episode and a preview. Without `tsd`, normal downloads do not make proactive session-list or capacity requests, though an exact qualifying playback refusal still triggers a read-only capacity assessment as part of bounded recovery.

AniDL compares a validated active-session count with the account's `concurrent_streams.N` benefit. This is a client-side capacity assessment, not a free-slot value reported by Crunchyroll. Missing, malformed, conflicting, or incomplete information is unknown and never authorizes an account-wide clear.

- **Capacity available:** continue without clearing sessions.
- **Capacity full and the command clear allowance is unused:** finish every deletion in the validated session snapshot, then obtain a fresh complete session count. Episode recovery may continue when that count is below the API-derived account limit; it need not be zero. Only one account-wide clear is allowed across the whole command, including archive entries.
- **Capacity full after that allowance is used:** wait for a slot without deleting sessions.
- **Capacity unknown before TSD intervenes:** never clear sessions. Initial preflight continues without clearing; after a qualifying refusal, the remaining ordinary retry policy applies.

Slot checks poll about every five seconds for up to 60 seconds, sharing one polling deadline within the recovery window. A verified available slot can resume the operation early, subject to any applicable `Retry-After`. Full capacity at the deadline stops the operation. A failed or unknown poll is not evidence of an available slot: TSD-owned preflight stops, and a TSD-owned refusal can replay only under the recovery rules below. With TSD off, the existing remaining ordinary retry policy still applies after an unknown poll. The 60-second interval never restarts for another retry.

No new playback or download acquisition starts while clearing or its final verification is pending. Every planned deletion must report success before the fresh count is checked. A failed, uncertain or cancelled deletion remains terminal even if a later count would be lower. An unknown or still-full final verification also stops that clear attempt. A nonzero count below the account limit means capacity is available; it does not mean every account session is gone or that a slot has been reserved.

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

Before assessing capacity after a qualifying refusal, AniDL closes sessions created by the failed acquisition group. The retry policy then depends on whether TSD actually intervenes:

| Stage | TSD off | TSD enabled |
| --- | --- | --- |
| Episode preflight | No proactive capacity check. | Check capacity; clear only a validated full snapshot when the command allowance is unused. |
| Full capacity during recovery | Poll for a slot within the existing deadline. | Finish an allowed clear and verify capacity, or use bounded slot polling if clearing is unavailable. |
| Free or unknown capacity, with no TSD intervention for this group | Remaining ordinary 10/30/60-second playback retry policy. | The same remaining ordinary policy. |
| Unresolved group after TSD intervenes | — | At most two TSD recovery retries within remaining limits; no ordinary 10/30/60-second waits for the same problem. |
| Later independent acquisition after the complete group succeeds | Use its existing policy and remaining limits. | Ordinary recovery is available unless TSD intervenes again; consumed shared limits stay consumed. |

Each TSD-owned replay needs a newly verified recovery event—a completed successful clear with verified available capacity, or a full-to-available slot transition—or an explicit valid `Retry-After` that fits the remaining limits. An unchanged free or unknown snapshot alone does not permit another replay. An impossible server wait is rejected before TSD clearing or polling and checked again before replay, using the original refusal time. Ordinary retries also honor `Retry-After`; a server wait over 60 seconds or beyond the remaining total wait allowance stops recovery.

TSD owns the complete related acquisition group: download preparation and playback acquisition for a discovery source, or the dependent video, audio and download acquisitions for a selected stream. One successful subrequest does not end recovery while another dependent request remains unresolved. A preflight intervention applies only to the next group it prepares.

If retry 1 succeeds for the complete group, that local sequence ends. A later independent incident starts its displayed numbering at retry 1 if allowance remains; retry 2 follows a failed retry 1 in the same unresolved sequence. Success never replenishes cumulative retries, post-reset limits, wait budgets, deadlines or the command-wide clear allowance. Reset operations allow at most two acquisition replays, other operations at most three, and TSD-owned incidents at most two within those existing limits.

Playback cooldown and slot-poll sleeps share a 120-second allowance. A scheduler allows 90 seconds of active work normally, or 180 seconds for `--qall` discovery; only actual admitted playback-recovery sleep extends that window. Ordinary request time and discovery pacing count as active work. Individual requests retain their 15-second bound, and owned-session cleanup is separately bounded. These are recovery-window limits; a whole command can include multiple episodes and other stages. The CLI uses the same transient row for discovery, retries and slot waits, and clears it when the operation ends.

Manifest discovery retains its nominal 1/5/20-second cooldown schedule and 45-second rate-wait budget. It shares the scheduler’s three retry slots and escalation state with playback recovery, so separating the TSD policy grants no extra attempts. Smaller retry batches and gaps remain in effect. The discovery timer only replaces normal pacing; zero does not disable recovery, and overlapping waits use the longer applicable requirement. Downstream manifest and media retry policies remain available where TSD does not handle the failure.

A successful recovery resumes the interrupted discovery source or stream-acquisition step. Completed downloads are not repeated.

Recovery cannot prove that Crunchyroll allocated or released a particular provider-side slot. If a refusal persists, stop and try again later.
