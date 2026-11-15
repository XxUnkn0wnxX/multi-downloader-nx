import { setOutputClearHook } from './log';

/** A transient row; logs clear it and the next frame restores it while active. */
export class WorkingIndicator {
	private timer?: ReturnType<typeof setInterval>;
	private painted = false;
	private frame = 0;
	private retry = 0;
	private retryUntil = 0;
	private retryLabel = 'Retrying video manifest';
	private retryTotal = 3;
	private slotStatus?: { active: number; limit: number; until: number };
	private readonly frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
	constructor(
		private readonly enabled: boolean,
		private readonly output: Pick<NodeJS.WriteStream, 'write'> = process.stdout,
		private label = 'Discovering video qualities'
	) {}
	start(): void {
		if (!this.enabled || this.timer) return;
		setOutputClearHook(() => this.clear());
		this.timer = setInterval(() => {
			if (!this.painted) this.output.write('\x1b[?25l');
			this.output.write(
				`\r\x1b[2K  ${this.frames[this.frame++ % this.frames.length]} ${this.retry ? `${this.retryLabel} (${this.retry}/${this.retryTotal} in ${Math.max(0, Math.ceil((this.retryUntil - Date.now()) / 1000))}s)` : this.slotStatus ? `Waiting for playback slot (${this.slotStatus.active}/${this.slotStatus.limit}; ${Math.max(0, Math.ceil((this.slotStatus.until - Date.now()) / 1000))}s left)` : this.label}`
			);
			this.painted = true;
		}, 100);
	}
	phase(label: string): void {
		this.slotStatus = undefined;
		this.label = label;
	}
	slot(active: number, limit: number, ms: number): void {
		this.slotStatus = { active, limit, until: Date.now() + ms };
	}
	waiting(retry: number, ms: number, kind: 'manifest' | 'playback' = 'manifest', playbackRetry = retry, playbackMax = 3): void {
		this.retryLabel = kind === 'playback' ? 'Retrying playback' : 'Retrying video manifest';
		this.retryTotal = kind === 'playback' ? playbackMax : 3;
		this.retry = kind === 'playback' && retry ? playbackRetry : retry;
		this.retryUntil = Date.now() + ms;
	}
	clear(): void {
		if (!this.painted) return;
		this.output.write('\r\x1b[2K\x1b[?25h');
		this.painted = false;
	}
	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		setOutputClearHook(undefined);
		this.clear();
	}
}
