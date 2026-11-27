import { existsSync } from 'node:fs';
import { Command, Help } from 'commander';
import { args, AvailableMuxer, configuredDefault, groups, optionAppliesToService } from './module.args';
import { leadingCliService } from './module.crunchy-cli-auth';
import { LanguageItem } from './module.langsData';
import { DownloadInfo } from '../@types/messageHandler';
import { HLSCallback } from './hls-download';
import leven from 'leven';
import { console } from './log';
import { CrunchyVideoPlayStreams, CrunchyAudioPlayStreams } from '../@types/enums';
import pj from '../package.json';

export let argvC: {
	[x: string]: unknown;
	ccTag: string;
	defaultAudio: LanguageItem;
	defaultSub: LanguageItem;
	ffmpegOptions: string[];
	mkvmergeOptions: string[];
	force: 'Y' | 'y' | 'N' | 'n' | 'C' | 'c';
	skipUpdate: boolean;
	dryRun?: boolean;
	checkStatus?: boolean;
	bypasssync?: boolean;
	videoTitle: string;
	override: string[];
	fsRetryTime: number;
	forceMuxer: AvailableMuxer | undefined;
	username: string | undefined;
	password: string | undefined;
	token: string | true | undefined;
	device: string | boolean | undefined;
	silentAuth: boolean;
	requestedActionOrSelector?: boolean;
	crunchyAuthExplicit?: boolean;
	tsdExplicit?: boolean;
	skipSubMux: boolean;
	downloadArchive: boolean;
	addArchive: boolean;
	but: boolean;
	auth: boolean | undefined;
	dlFonts: boolean | undefined;
	search: string | undefined;
	searchType: string;
	page: number | undefined;
	locale: string;
	new: boolean | undefined;
	movieListing: string | undefined;
	showRaw: string | undefined;
	seasonRaw: string | undefined;
	series: string | undefined;
	s: string | undefined;
	srz: string | undefined;
	e: string | undefined;
	extid: string | undefined;
	q: number;
	qall: boolean;
	discoveryTimmer?: number;
	x: number;
	cstream: keyof typeof CrunchyVideoPlayStreams;
	vstream: keyof typeof CrunchyVideoPlayStreams;
	astream: keyof typeof CrunchyAudioPlayStreams;
	tsd: boolean | undefined;
	partsize: number;
	hslang: string;
	dlsubs: string[];
	skipMuxOnSubFail: boolean;
	novids: boolean | undefined;
	noaudio: boolean | undefined;
	nosubs: boolean | undefined;
	dubLang: string[];
	CC: boolean;
	all: boolean;
	fontSize: number;
	combineLines: boolean;
	allDubs: boolean;
	timeout: number;
	waittime: number;
	simul: boolean;
	mp4: boolean;
	skipmux: boolean | undefined;
	fileName: string;
	numbers: number;
	nosess: string;
	debug: boolean | undefined;
	raw: boolean;
	rawoutput: string;
	nocleanup: boolean;
	help: boolean | undefined;
	service: 'crunchy' | 'hidive' | 'adn';
	update: boolean;
	fontName: string | undefined;
	_: (string | number)[];
	$0: string;
	dlVideoOnce: boolean;
	chapters: boolean;
	removeBumpers: boolean;
	originalFontSize: boolean;
	keepAllVideos: boolean;
	syncTiming: boolean;
	callbackMaker?: (data: DownloadInfo) => HLSCallback;
	// Subtitle Fix Options
	noASSConv: boolean;
	noSubFix: boolean;
	srtAssFix: boolean;
	layoutResFix: boolean;
	scaledBorderAndShadowFix: boolean;
	scaledBorderAndShadow: 'yes' | 'no';
	originalScriptFix: boolean;
	subtitleTimestampFix: boolean;
	// Proxy
	proxy: string;
	proxyAll: boolean;
};

export type ArgvType = typeof argvC;

const singleServiceError = 'Choose one service per command. Put --service and its name first.';

// Normalize legacy CLI spellings while preserving positional arguments after the delimiter.
const processArgv = (program: Command, requireSingleService = false) => {
	const argv = process.argv.slice(0, 2);
	let requiredOperand = false;
	let sawService = false;
	const push = (arg: string) => {
		argv.push(arg);
		if (requiredOperand) {
			requiredOperand = false;
			return;
		}
		// Match Commander's exact options first, then its grouped short-option grammar.
		let remaining = arg;
		while (true) {
			const option = program.options.find((candidate) => candidate.short === remaining || candidate.long === remaining);
			if (option) {
				requiredOperand = option.required;
				return;
			}
			if (remaining.length <= 2 || remaining[0] !== '-' || remaining[1] === '-') return;
			const short = program.options.find((candidate) => candidate.short === remaining.slice(0, 2));
			if (!short || short.required || short.optional) return;
			remaining = `-${remaining.slice(2)}`;
		}
	};
	const arrayFlags = args.filter((a) => a.type === 'array').map((a) => `--${a.name}`);

	for (let i = 2; i < process.argv.length; i++) {
		const arg = process.argv[i];

		if (arg === '--' && !requiredOperand) return { argv: argv.concat(process.argv.slice(i)), delimiterIndex: argv.length };
		if (requireSingleService && /^--?service(?:=|$)/.test(arg)) {
			if (sawService) program.error(singleServiceError);
			sawService = true;
		}

		const next = process.argv[i + 1];
		if ((arg === '--token' || arg === '-token') && next?.startsWith('-') && next !== '--') {
			const flag = next.split('=', 1)[0];
			const long = flag.replace(/^-(?=[a-zA-Z]{2,}$)/, '--');
			const known = program.options.some((option) => option.short === flag || option.long === flag || option.long === long);
			// A dash-prefixed file was valid with the old required token argument. Real flags still take precedence.
			if (!known) {
				if (!existsSync(next)) program.error('Invalid --token input or unknown option. With Crunchyroll selected, use --token alone for examples.');
				push(`--token=${next}`);
				i++;
				continue;
			}
		}

		if (arg === '--qall=false' || arg === '--qall=true') {
			push(arg === '--qall=false' ? '--no-qall' : '--qall');
			continue;
		}

		if (/^-[a-zA-Z]{2,}$/.test(arg)) {
			const found = args.find((a) => a.name === arg.substring(1) || a.alias === arg.substring(1));
			if (found) {
				push(`--${found.name}`);
				continue;
			}
		}

		if (arrayFlags.includes(arg)) {
			const col = [];
			let n = i + 1;

			while (n < process.argv.length && !process.argv[n].startsWith('-')) {
				col.push(process.argv[n]);
				n++;
			}

			push(arg);
			push(col.join(' '));
			i = n - 1;
			continue;
		}

		push(arg);
	}

	return { argv, delimiterIndex: undefined };
};

// Preserve explicit empty selectors and positional arguments for standalone actions.
const actionSelectors = new Set([
	'auth',
	'device',
	'token',
	'silentAuth',
	'dlFonts',
	'cmsindex',
	'new',
	'search',
	'search-type',
	'page',
	'series',
	'movie-listing',
	'show-raw',
	'season-raw',
	'show-list-raw',
	's',
	'e',
	'extid',
	'all',
	'but',
	'update',
	'downloadArchive',
	'addArchive'
]);
const markActionSelection = (program: Command, parsed: ArgvType, isGUI: boolean) => {
	const explicit = (name: string) => program.getOptionValueSource(name) === 'cli';
	parsed.crunchyAuthExplicit = explicit('device') || explicit('token');
	if (!isGUI && parsed.service === 'crunchy' && (parsed.crunchyAuthExplicit || explicit('auth') || explicit('silentAuth'))) {
		// Saved CLI defaults must not turn an explicit login or help request into two competing methods.
		for (const name of ['token', 'username', 'password', 'silentAuth']) {
			if (!explicit(name)) delete parsed[name];
		}
	}
	parsed.tsdExplicit = program.getOptionValueSource('tsd') === 'cli' && parsed.tsd === true;
	parsed.requestedActionOrSelector =
		program.args.length > 0 ||
		args.some((item) => {
			if (!actionSelectors.has(item.name)) return false;
			const option = declaredOption(program, item.name);
			if (!option) return false;
			const native = option.attributeName();
			return item.type === 'boolean'
				? parsed[native] === true
				: program.getOptionValueSource(native) === 'cli' || (item.default === undefined && parsed[native] !== undefined);
		});
};

const flagName = (name: string) => (name.length === 1 ? '-' : '--') + name;
const declaredOption = (program: Command, name: string) => program.options.find((option) => (name.length === 1 ? option.short === `-${name}` : option.long === `--${name}`));

const acceptsServiceOption = (item: (typeof args)[number], service: string) =>
	optionAppliesToService(item, service) || item.compatibilityServices?.some((name) => name === service);

const currentCliService = (isGUI: boolean) => (isGUI ? undefined : leadingCliService(process.argv.slice(2)));

const validateServiceOptions = (program: Command, service: ArgvType['service']) => {
	if (!service) return;
	for (const item of args) {
		if (acceptsServiceOption(item, service)) continue;
		const option = declaredOption(program, item.name);
		if (!option || program.getOptionValueSource(option.attributeName()) !== 'cli') continue;
		const allowed = item.service.map((name) => `--service ${name}`).join(' or ');
		console.error(`${flagName(item.name)} is unavailable with --service ${service}.${allowed ? ` Use ${allowed}.` : ' This option has no effect in this CLI version.'}`);
		process.exit(1);
	}
};

const normalizeParsed = (program: Command, parsed: ArgvType) => {
	for (const item of args) {
		const native = declaredOption(program, item.name)?.attributeName();
		if (!native || parsed[native] === undefined) continue;
		parsed[item.name] = parsed[native];
		if (item.alias) parsed[item.alias] = parsed[native];
	}
};

// Normalize and validate only the effective dub language input, after CLI/config precedence.
const normalizeDubLang = (parsed: ArgvType, validate: boolean) => {
	const values: unknown[] = Array.isArray(parsed.dubLang) ? parsed.dubLang : [parsed.dubLang];
	const codes = values.flatMap((value) =>
		typeof value === 'string'
			? value
					.trim()
					.split(/[\s,]+/)
					.filter(Boolean)
			: [String(value)]
	);
	const choices = args.find((item) => item.name === 'dubLang')?.choices ?? [];
	const invalid = [...new Set(codes.filter((code) => !choices.includes(code)))];
	if (!codes.length || values.some((value) => typeof value === 'string' && !value.trim())) invalid.push('<empty>');
	if (validate && invalid.length) {
		console.error(`Invalid language tags for --dubLang: ${invalid.join(', ')}`);
		process.exit(1);
	}
	parsed.dubLang = codes;
};

const normalizeCC = (parsed: ArgvType, isGUI: boolean) => {
	const value: unknown = parsed.CC;
	if (value === true || value === 'true') parsed.CC = true;
	else if (value === false || value === 'false') parsed.CC = false;
	else if (isGUI || !parsed.service || parsed.service === 'crunchy') {
		console.error('Invalid value for --CC: expected true or false');
		process.exit(1);
	}
};

/** Validate raw status arguments before Commander can exit for help or version. */
export function statusInvocation(argv: string[]): 'none' | 'valid' | 'invalid' {
	if (!argv.some((arg) => arg === '--check-status' || arg.startsWith('--check-status='))) return 'none';
	let status = 0,
		service = 0;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--check-status') status++;
		else if (arg === '--debug') continue;
		else if (arg === '--service' && argv[i + 1] === 'crunchy') {
			service++;
			i++;
		} else if (arg === '--service=crunchy') service++;
		else return 'invalid';
	}
	return status === 1 && service === 1 ? 'valid' : 'invalid';
}

const appArgv = (
	cfg: {
		[key: string]: unknown;
	},
	isGUI = false
) => {
	if (argvC) return argvC;
	if (!isGUI && statusInvocation(process.argv.slice(2)) === 'invalid') throw new Error('--check-status requires only --service crunchy and optional --debug');
	const argv = getCommander(cfg, isGUI, !isGUI, currentCliService(isGUI));
	argv.parse(processArgv(argv, !isGUI).argv);
	const parsed = argv.opts() as ArgvType;
	if (!isGUI) validateServiceOptions(argv, parsed.service);
	if (!isGUI && parsed.version) {
		global.console.log(pj.version);
		process.exit(0);
	}

	normalizeDubLang(parsed, !isGUI && !(parsed.downloadArchive && argv.getOptionValueSource('dubLang') !== 'cli'));
	normalizeCC(parsed, isGUI);
	normalizeParsed(argv, parsed);
	markActionSelection(argv, parsed, isGUI);

	if (!isGUI && (process.argv.length <= 2 || parsed.help)) {
		argv.outputHelp();
		process.exit(0);
	}

	argvC = parsed;
	return parsed;
};

const overrideArguments = (cfg: { [key: string]: unknown }, override: Partial<typeof argvC>, isGUI = false) => {
	const argv = getCommander(cfg, isGUI, false, currentCliService(isGUI));
	const { argv: baseArgv, delimiterIndex } = processArgv(argv);
	const overrides: string[] = [];

	for (const [rawKey, val] of Object.entries(override)) {
		if (val === undefined) continue;
		const item = args.find((arg) => arg.name === rawKey || arg.alias === rawKey || declaredOption(argv, arg.name)?.attributeName() === rawKey);
		const key = item?.name ?? rawKey;
		if (typeof val === 'boolean') {
			if (key === 'CC') {
				overrides.push('--CC', String(val));
				continue;
			}
			if (!val && key === 'qall') overrides.push('--no-qall');
			if (val) overrides.push(key.length > 1 ? `--${key}` : `-${key}`);
		} else {
			overrides.push(key.length > 1 ? `--${key}` : `-${key}`, String(val));
		}
	}

	baseArgv.splice(delimiterIndex ?? baseArgv.length, 0, ...overrides);
	const data = argv.parse(baseArgv);
	const parsed = data.opts() as ArgvType;
	// Archive replay must honor its exclusions even when --all is set on the CLI or in the defaults.
	if (override.all === false) parsed.all = false;

	normalizeDubLang(parsed, !isGUI);
	normalizeCC(parsed, isGUI);
	normalizeParsed(data, parsed);
	markActionSelection(data, parsed, isGUI);

	if (!isGUI && (process.argv.length <= 2 || parsed.help)) {
		argv.outputHelp();
		process.exit(0);
	}

	argvC = parsed;
};

export { appArgv, overrideArguments, getCommander };

const getCommander = (cfg: Record<string, unknown>, isGUI: boolean, requireSingleService = false, service?: string) => {
	const program = new Command();
	program
		.name(process.platform === 'win32' ? 'aniDL.exe' : 'aniDL')
		.description(pj.description)
		.usage('--service <service> [options]')
		.allowUnknownOption(false)
		.allowExcessArguments(true);

	// Let the CLI validate the entire invocation before displaying a requested version.
	if (requireSingleService) program.option('-v, --version', 'Show version');
	else program.version(pj.version, '-v, --version', 'Show version');

	const data = args.map((a) => {
		return {
			...a,
			demandOption: !isGUI && a.demandOption,
			group: groups[a.group],
			default: configuredDefault(a, cfg),
			// A setting for another service can be present in the same YAML file.
			transformer: !service || acceptsServiceOption(a, service) ? a.transformer : undefined
		};
	});

	for (const item of data) {
		const option = program.createOption(
			(item.alias
				? `${item.alias.length === 1 ? `-${item.alias}` : `--${item.alias}`}, ${item.name.length === 1 ? `-${item.name}` : `--${item.name}`}`
				: item.name.length === 1
					? `-${item.name}`
					: `--${item.name}`) + (['CC', 'device', 'token'].includes(item.name) ? ' [value]' : item.type === 'boolean' ? '' : ` <value>`),
			item.describe ?? ''
		);
		if (item.default !== undefined) {
			const value = item.transformer ? item.transformer(item.default as any) : item.default;
			option.default(value, ['token', 'password', 'username'].includes(item.name) ? 'configured' : undefined);
		}

		const optionNames = [...args.map((a) => `--${a.name}`), ...args.map((a) => (a.alias ? `-${a.alias}` : null)).filter(Boolean)];

		option.argParser((value) => {
			if (item.name === 'service' && requireSingleService && program.getOptionValueSource('service') === 'cli') program.error(singleServiceError);
			if (['CC', 'device', 'token'].includes(item.name)) return value;
			if (item.transformer) return item.transformer(value);

			// Prevent from passing other options als value for option
			if (value && typeof value === 'string' && value.startsWith('-') && optionNames.includes(value)) return undefined;

			if (item.type === 'boolean') {
				if (value === undefined) return true;
				if (value === 'true') return true;
				if (value === 'false') return false;
				return Boolean(value);
			}

			if (item.name === 'dubLang') return value;

			if (item.type === 'array') {
				if (typeof value === 'string' && value.includes(',')) {
					return value.split(',').map((v) => v.trim());
				}

				if (typeof value === 'string' && value.includes(' ')) {
					return value.split(' ').map((v) => v.trim());
				}

				return Array.isArray(value) ? value : [value];
			}

			if (item.type === 'number') {
				const num = Number(value);
				return Number.isFinite(num) ? num : 0;
			}

			if (item.type === 'string') {
				if (value === undefined) return undefined;
				return value;
			}

			if (item.choices && !(isGUI && item.name === 'service')) {
				if (!item.choices.includes(value)) {
					console.error(`Invalid value '${value}' for --${item.name}. Allowed: ${item.choices.join(', ')}`);
					process.exit(1);
				}
			}
			return value;
		});

		program.addOption(option);
	}

	program.addOption(program.createOption('--no-qall').hideHelp());

	program.configureHelp({
		visibleOptions(command) {
			const selected = command.opts().service as string | undefined;
			return Help.prototype.visibleOptions.call(this, command).filter((option) => {
				const metadata = args.find((item) => option.long === `--${item.name}` || (item.name.length === 1 && option.short === `-${item.name}`));
				return !metadata || optionAppliesToService(metadata, selected);
			});
		},
		optionDescription(option) {
			const full = Help.prototype.optionDescription.call(this, option);
			if (program.opts().service === 'crunchy') return full;
			const shared = args.find((item) => option.long === `--${item.name}`)?.sharedHelp;
			return shared ? full.replace(option.description, () => shared) : full;
		}
	});

	// Custom logic for suggesting corrections for misspelled options
	program.hook('preAction', (_, command) => {
		const used = command.parent?.args || [];

		const validOptions = [...args.map((a) => a.name), ...args.map((a) => a.alias).filter((a): a is string => a !== undefined)];

		const unknownOptions = used.filter((arg) => arg.startsWith('-'));
		const suggestions: Record<string, boolean> = {};

		unknownOptions.forEach((opt) => {
			const cleaned = opt.replace(/^-+/, '');

			const closest = validOptions.find((vo) => {
				const dist = leven(vo, cleaned);
				return dist <= 2 && dist > 0;
			});

			if (closest && !suggestions[closest]) {
				console.info(`Unknown option ${opt}, did you mean --${closest}?`);
				suggestions[closest] = true;
			} else if (!suggestions[cleaned]) {
				console.info(`Unknown option ${opt}`);
				suggestions[cleaned] = true;
			}
		});
	});

	return program;
};
