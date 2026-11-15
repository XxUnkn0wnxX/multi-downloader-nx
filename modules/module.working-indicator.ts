import { setOutputClearHook } from './log';

/** A transient row; logs clear it and the next frame restores it while active. */
export class WorkingIndicator {
	private timer?: ReturnType<typeof setInterval>;
	private painted = false;
	private frame = 0;
	private retry = 0;
	private retryUntil = 0;
	private readonly frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
	constructor(
		private readonly enabled: boolean,
		private readonly output: Pick<NodeJS.WriteStream, 'write'> = process.stdout
	) {}
	start(): void {
		if (!this.enabled || this.timer) return;
		setOutputClearHook(() => this.clear());
		this.timer = setInterval(() => {
			if (!this.painted) this.output.write('\x1b[?25l');
			this.output.write(
				`\r\x1b[2K  ${this.frames[this.frame++ % this.frames.length]} ${this.retry ? `Retrying video manifest (${this.retry}/3 in ${Math.max(0, Math.ceil((this.retryUntil - Date.now()) / 1000))}s)` : 'Discovering video qualities'}`
			);
			this.painted = true;
		}, 100);
	}
	waiting(retry: number, ms: number): void {
		this.retry = retry;
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
