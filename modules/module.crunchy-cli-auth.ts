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

/** Keep command examples shareable when a shell alias expands to an absolute script path. */
export function cliInvocation(): string {
	if ((process as NodeJS.Process & { pkg?: unknown }).pkg && path.dirname(process.execPath) === process.cwd()) return process.platform === 'win32' ? 'aniDL.exe' : './aniDL';
	return 'anidl';
}

export function leadingCliService([first, value]: string[]): string | undefined {
	if (first === '--service' || first === '-service') return value;
	if (first?.startsWith('--service=')) return first.slice('--service='.length);
	return undefined;
}

/** Recovery can also originate in the GUI, where the reader needs a complete CLI command. */
export function crunchyLoginInstruction(options: string): string {
	if (process.env?.isGUI !== 'true' && leadingCliService(process.argv.slice(2)) === 'crunchy') return `Keep your Crunchyroll command and replace its options with:\n  ${options}`;
	return `Run:\n  ${cliInvocation()} --service crunchy ${options}`;
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
	if (argv.silentAuth || argv.username !== undefined || argv.password !== undefined)
		return {
			kind: 'error',
			message: 'Crunchyroll CLI sign-in uses --device or --token. Keep the same command and replace the sign-in options with one of these:\n  --device\n  --token'
		};
	if (argv.auth)
		return {
			kind: 'error',
			message: `Crunchyroll now uses --device or --token to sign in.
HIDIVE and ADN still use --auth with a username or email and password.

Run the same command again, replacing --auth with one of the options below.

Used --auth for Android phone sign-in? Use
  --device android

Show the Android TV and phone sign-in options
  --device

Show how to sign in with a browser cookie or cookies file
  --token`
		};
	if (argv.device === true)
		return {
			kind: 'notice',
			message: `Which Crunchyroll login do you need?
Run the same command again, replacing --device with your choice below.

Android TV — enter a code on the Crunchyroll page that opens.
  --device androidtv

Android phone or tablet — sign in on the Crunchyroll website, then paste
the final address into this terminal. AniDL hides it for your privacy.
AniDL needs the Android phone client settings for this method.
  --device android

With the default settings, Android TV supplies video and Android phone
supplies audio. Sign in once for each device using the same account.`
		};
	if (argv.token === true)
		return {
			kind: 'notice',
			message: `Use your Crunchyroll browser login for Chrome or Firefox streams.
Run the same command again, replacing --token with one of the examples below.

Have a cookies file? If cookies.txt is in this folder, use
  --token "cookies.txt"
If the file is elsewhere, put its full path inside the quotes. Using a
file keeps the cookie value out of your command history.

Have the cookie value instead? Replace YOUR_COOKIE_VALUE with the value
of the Crunchyroll cookie named etp_rt. Keep this value private.
  --token "YOUR_COOKIE_VALUE"`
		};
	return { kind: 'continue' };
}
