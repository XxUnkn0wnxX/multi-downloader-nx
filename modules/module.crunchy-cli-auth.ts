import path from 'path';

export type CrunchyCliAuth = {
	service?: string;
	auth?: boolean;
	device?: string | boolean;
	token?: string | true;
	silentAuth?: boolean;
	username?: string;
	password?: string;
	crunchyAuthExplicit?: boolean;
};
export type CrunchyCliAuthDecision = { kind: 'continue' } | { kind: 'notice' | 'error'; message: string };

/** Display a command appropriate for the executable or local Node entry point. */
export function cliInvocation(): string {
	const quote = (value: string) => {
		if (/^[a-zA-Z0-9_./-]+$/.test(value)) return value;
		if (process.platform === 'win32') return `"${value}"`;
		return "'" + value.replace(/'/g, "'\"'\"'") + "'";
	};
	if ((process as NodeJS.Process & { pkg?: unknown }).pkg) {
		if (process.env?.isGUI === 'true') return process.platform === 'win32' ? 'aniDL.exe' : './aniDL';
		const executable = process.execPath;
		if (path.dirname(executable) !== process.cwd()) return quote(executable);
		const name = path.basename(executable);
		return process.platform === 'win32' ? quote(name) : quote(`./${name}`);
	}
	let entry = process.argv[1];
	if (!entry) return process.platform === 'win32' ? 'aniDL.exe' : './aniDL';
	if (process.env?.isGUI === 'true') entry = path.join(path.dirname(entry), 'index' + path.extname(entry));
	let relative = path.relative(process.cwd(), entry) || path.basename(entry);
	if (relative.startsWith('-')) relative = `.${path.sep}${relative}`;
	if (path.extname(entry) === '.ts') {
		const tsx = path.join(path.dirname(entry), 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
		const launcher = path.dirname(entry) === process.cwd() ? 'pnpm exec tsx' : quote(tsx);
		return `${launcher} ${quote(relative)}`;
	}
	return `node ${quote(relative)}`;
}

export function crunchyCliAuthDecision(argv: CrunchyCliAuth): CrunchyCliAuthDecision {
	const present = (value: unknown) => value !== undefined && value !== false;
	if (argv.service && argv.service !== 'crunchy') {
		if (argv.crunchyAuthExplicit && (present(argv.device) || present(argv.token)))
			return { kind: 'error', message: '--device and --token are only supported for Crunchyroll.' };
		return { kind: 'continue' };
	}
	const modes = Number(present(argv.device)) + Number(present(argv.token)) + Number(!!argv.auth) + Number(!!argv.silentAuth);
	if (modes === 0 && argv.username === undefined && argv.password === undefined) return { kind: 'continue' };
	if (modes > 1) return { kind: 'error', message: 'Choose only one of --device, --token, --auth, or --silentAuth.' };
	if (argv.device === '') return { kind: 'error', message: 'Missing --device value. Choose androidtv or android, or use --device alone for help.' };
	if (argv.token === '') return { kind: 'error', message: 'Missing --token value. Supply a cookie or file, or use --token alone for help.' };
	if (argv.device !== undefined && argv.device !== false && argv.device !== true && argv.device !== 'androidtv' && argv.device !== 'android')
		return { kind: 'error', message: 'Invalid --device value. Choose androidtv or android.' };
	if (!argv.service && (present(argv.device) || present(argv.token))) return { kind: 'error', message: 'Select Crunchyroll with --service crunchy.' };
	if (argv.service !== 'crunchy') {
		if (!argv.service && argv.auth) return { kind: 'error', message: 'Choose a service with --service: crunchy, hidive, or adn.' };
		return { kind: 'continue' };
	}
	const cmd = `${cliInvocation()} --service crunchy`;
	if (argv.silentAuth || argv.username !== undefined || argv.password !== undefined)
		return { kind: 'error', message: `Crunchyroll CLI sign-in uses --device or --token. Show the sign-in options:\n  ${cmd} --device\n  ${cmd} --token` };
	if (argv.auth)
		return {
			kind: 'error',
			message: `Crunchyroll now uses --device or --token to sign in.
HIDIVE and ADN still use --auth with a username or email and password.

Used --auth for Android phone sign-in? Run
  ${cmd} --device android

Show the Android TV and phone sign-in options
  ${cmd} --device

Show how to sign in with a browser cookie or cookies file
  ${cmd} --token`
		};
	if (argv.device === true)
		return {
			kind: 'notice',
			message: `Which Crunchyroll login do you need?

Android TV — enter a code on the Crunchyroll page that opens.
  ${cmd} --device androidtv

Android phone or tablet — sign in on the Crunchyroll website, then paste
the final address into this terminal. AniDL hides it for your privacy.
AniDL needs the Android phone client settings for this method.
  ${cmd} --device android

With the default settings, Android TV supplies video and Android phone
supplies audio. Run both commands, one at a time, using the same account.`
		};
	if (argv.token === true)
		return {
			kind: 'notice',
			message: `Use your Crunchyroll browser login for Chrome or Firefox streams.

Have a cookies file? If cookies.txt is in this folder, run
  ${cmd} --token "cookies.txt"
If the file is elsewhere, put its full path inside the quotes. Using a
file keeps the cookie value out of your command history.

Have the cookie value instead? Replace YOUR_COOKIE_VALUE with the value
of the Crunchyroll cookie named etp_rt. Keep this value private.
  ${cmd} --token "YOUR_COOKIE_VALUE"`
		};
	return { kind: 'continue' };
}
