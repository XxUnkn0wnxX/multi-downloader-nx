import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { retryAfterMs } from './module.crunchy-discovery-scheduler';

export type PlaybackWaitRecord = { version: 1; binding: string; observed: number; deadline: number };
const pad = (value: number) => String(value).padStart(2, '0');
export function formatPlaybackDuration(milliseconds: number): string {
	const totalSeconds = Math.ceil(Math.max(0, milliseconds) / 1000);
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);
	if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
	if (totalMinutes > 0) return `${pad(totalMinutes)}:${pad(seconds)}`;
	return `${totalSeconds}s`;
}
export function formatLocalRetryTime(milliseconds: number): string {
	const date = new Date(Math.ceil(milliseconds / 1000) * 1000);
	return `${pad(date.getDate())}:${pad(date.getMonth() + 1)}:${date.getFullYear()} - ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export function accountBinding(account: unknown): string | undefined {
	return typeof account === 'string' && account.trim() ? createHash('sha256').update(account).digest('hex') : undefined;
}
export function readPlaybackWait(directory: string, binding: string | undefined): PlaybackWaitRecord | undefined {
	if (!directory || !binding || !/^[a-f0-9]{64}$/.test(binding)) return undefined;
	let fd: number | undefined;
	try {
		fd = fs.openSync(path.join(directory, 'cr_playback_status.json'), 'r');
		const bytes = Buffer.alloc(2049);
		const size = fs.readSync(fd, bytes, 0, bytes.length, 0);
		if (size > 2048) return undefined;
		const value = JSON.parse(bytes.subarray(0, size).toString('utf8')) as PlaybackWaitRecord;
		return value?.version === 1 &&
			value.binding === binding &&
			Number.isSafeInteger(value.observed) &&
			Number.isSafeInteger(value.deadline) &&
			value.observed >= 0 &&
			value.deadline >= value.observed &&
			value.deadline <= 8640000000000000
			? value
			: undefined;
	} catch {
		return undefined;
	} finally {
		if (fd !== undefined)
			try {
				fs.closeSync(fd);
			} catch {
				/* Cache is optional. */
			}
	}
}
export function observePlaybackWait(directory: string, binding: string | undefined, response: Response, now = Date.now()): void {
	if (!directory || !binding || !/^[a-f0-9]{64}$/.test(binding) || response.status !== 429 || !Number.isSafeInteger(now) || now < 0) return;
	const delay = retryAfterMs(response.headers.get('retry-after'), response.headers.get('date'), now);
	if (delay === undefined || !Number.isFinite(delay) || !Number.isSafeInteger(now + delay) || now + delay > 8640000000000000) return;
	const deadline = now + delay;
	const previous = readPlaybackWait(directory, binding);
	if (previous && previous.deadline > now && previous.deadline >= deadline) return;
	const target = path.join(directory, 'cr_playback_status.json');
	const temporary = `${target}.${randomUUID()}.tmp`;
	try {
		fs.writeFileSync(temporary, JSON.stringify({ version: 1, binding, observed: now, deadline }), { mode: 0o600, flag: 'wx' });
		fs.renameSync(temporary, target);
	} catch {
		try {
			fs.unlinkSync(temporary);
		} catch {
			/* Cache is optional. */
		}
	}
}
