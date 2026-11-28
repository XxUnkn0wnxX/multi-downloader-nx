import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { homedir, release } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const launchEnv = { ...process.env };
const launchHome = homedir();

// Archive digests from the corresponding Electron release's SHASUMS256.txt.
const hashes: Record<string, string> = {
	'37.10.3-darwin-x64': 'e545e2a41e5fd7d28bf1349b4f60f1bcfd8e4c216f57b2d3e698ec1c00b719cf',
	'37.10.3-darwin-arm64': '24529be1f2f87c587d06c7474607f1b57d1184b3f45d916cac33791de3a70014',
	'43.8.13-darwin-x64': '6a10b200799c43ef0b608e527ff42132c58c863889ff5946d735c2ba31a18904',
	'43.8.13-darwin-arm64': '82ed76b2e3e1c8c670e135e081aa6e3b72015e72b3829cc88427c272e5489d5e',
	'45.5.0-darwin-x64': '9ce4b0e25ce95e743b2d8f04ebfbfd76027060ff8b47829de22334fbdbdd4cc4',
	'45.5.0-darwin-arm64': '00d345b061064de7e6e2c02bec7ffa1adb7ef488fe4b673bd8ad3e059a182245',
	'45.5.0-linux-x64': '36b44cd0c3d355ee74557bea2353e4539f96e1a09733a52a052bd093134a6142',
	'45.5.0-linux-arm64': 'f2bd21b4167dbf0d27968347127afa6703161fdb513b1f3c61da5de9289cac0a',
	'45.5.0-win32-x64': '20155c8b8aa5b1f575f3757bdf21490e0bac2f19a65a26ce9ba99bcf9f2c69bd',
	'45.5.0-win32-arm64': '5b00f9a9fb4dff9ce448b7ff33eae14af9318b3207f7a66170254cd541becd48'
};

export const PHONE_RUNTIME_ERROR = 'CrunchyPhoneRuntimeError';

export function phoneWindowEnvironment(): NodeJS.ProcessEnv {
	return { ...launchEnv };
}

function runtimeError(message: string): Error {
	const error = new Error(message);
	error.name = PHONE_RUNTIME_ERROR;
	return error;
}

async function executableExists(file: string): Promise<boolean> {
	try {
		if (!(await stat(file)).isFile()) return false;
		await access(file, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export function phoneWindowPath(): string {
	const dirnameForBuild = 'pkg' in process ? dirname(process.execPath) : join(__dirname, '..');
	return join(dirnameForBuild, 'crunchyroll-phone-signin.cjs');
}

function runtimeAsset() {
	const platform = process.platform;
	const darwin = platform === 'darwin' ? Number(release().split('.')[0]) : 0;
	if (platform === 'darwin' && darwin < 20) return;
	const version = darwin === 20 ? '37.10.3' : darwin === 21 ? '43.8.13' : '45.5.0';
	const target = `${version}-${platform}-${process.arch}`;
	const digest = hashes[target];
	if (!digest) return;
	return { version, name: `electron-v${target}`, digest };
}

async function downloadArchive(url: string, file: string, expected: string): Promise<void> {
	const response = await fetch(url, { signal: AbortSignal.timeout(240_000) });
	if (!response.ok || !response.body) throw new Error('Download failed');
	const digest = createHash('sha256');
	let received = 0;
	await pipeline(
		Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
		new Transform({
			transform(chunk: Buffer, _encoding, done) {
				received += chunk.length;
				if (received > 256 * 1024 * 1024) return done(new Error('Download exceeds the size limit'));
				digest.update(chunk);
				done(null, chunk);
			}
		}),
		createWriteStream(file, { flags: 'wx', mode: 0o600 })
	);
	if (digest.digest('hex') !== expected) throw new Error('Unexpected archive checksum');
}

export async function resolvePhoneRuntime(): Promise<string> {
	const helperExists = await stat(phoneWindowPath()).then(
		(entry) => entry.isFile(),
		() => false
	);
	if (!helperExists) throw runtimeError('The Crunchyroll sign-in helper is missing. Keep the files from the AniDL build together.');
	const override = launchEnv.ANIDL_CRUNCHY_PHONE_WEBVIEW;
	if (override) {
		if (isAbsolute(override) && (await executableExists(override))) return override;
		throw runtimeError('Set ANIDL_CRUNCHY_PHONE_WEBVIEW to the absolute path of a working Electron executable.');
	}
	const asset = runtimeAsset();
	const linux = process.platform === 'linux';
	const alpine =
		linux &&
		(await access('/etc/alpine-release').then(
			() => true,
			() => false
		));
	if (!asset || alpine || (linux && !launchEnv.DISPLAY && !launchEnv.WAYLAND_DISPLAY)) {
		throw runtimeError('The Crunchyroll sign-in window needs a supported desktop session. Use --device androidtv or import a browser cookie with --token.');
	}
	const mac = process.platform === 'darwin';
	const windows = process.platform === 'win32';
	const overrideCache = windows ? launchEnv.LOCALAPPDATA : launchEnv.XDG_CACHE_HOME;
	const cacheBase = mac
		? join(launchHome, 'Library', 'Caches')
		: overrideCache && isAbsolute(overrideCache)
			? overrideCache
			: windows
				? join(launchHome, 'AppData', 'Local')
				: join(launchHome, '.cache');
	const cache = join(cacheBase, 'AniDL', 'phone-signin');
	const installed = join(cache, asset.name);
	const executableName = mac ? 'Electron.app/Contents/MacOS/Electron' : windows ? 'electron.exe' : 'electron';
	const executable = join(installed, executableName);
	if (await executableExists(executable)) return executable;
	if (
		await stat(installed).then(
			() => true,
			() => false
		)
	) {
		// Another process could have finished publishing between the two checks.
		if (await executableExists(executable)) return executable;
		throw runtimeError(`Move the incomplete Crunchyroll sign-in runtime out of this folder, then try again.\n${installed}`);
	}

	const systemRoot = launchEnv.SystemRoot;
	const extractor = mac ? '/usr/bin/ditto' : windows ? join(systemRoot && isAbsolute(systemRoot) ? systemRoot : 'C:\\Windows', 'System32', 'tar.exe') : 'unzip';
	if (!mac && !windows) {
		try {
			await exec(extractor, ['-v'], { timeout: 3000, env: launchEnv });
		} catch {
			throw runtimeError('Install unzip to prepare the Crunchyroll sign-in window on Linux.');
		}
	}
	let staging: string | undefined;
	try {
		await mkdir(cache, { recursive: true, mode: 0o700 });
		staging = await mkdtemp(join(cache, 'prepare-'));
		const archive = join(staging, 'runtime.zip');
		const unpacked = join(staging, 'runtime');
		process.stdout.write('Downloading the Crunchyroll sign-in window (first use).\n');
		await downloadArchive(`https://github.com/electron/electron/releases/download/v${asset.version}/${asset.name}.zip`, archive, asset.digest);
		await mkdir(unpacked, { mode: 0o700 });
		const args = mac ? ['-x', '-k', archive, unpacked] : windows ? ['-xf', archive, '-C', unpacked] : ['-q', archive, '-d', unpacked];
		await exec(extractor, args, { timeout: 120_000, windowsHide: true, env: launchEnv });
		if (!(await executableExists(join(unpacked, executableName)))) throw new Error('Runtime executable missing');
		try {
			await rename(unpacked, installed);
		} catch (error) {
			if (!(await executableExists(executable))) throw error;
		}
		return executable;
	} catch {
		throw runtimeError('Could not prepare the Crunchyroll sign-in window. Check your connection and desktop requirements, then try again.');
	} finally {
		if (staging) await rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
	}
}
