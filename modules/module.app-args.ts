import { Command, Help } from 'commander';
import { args, AvailableMuxer, configuredDefault, groups } from './module.args';
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
	token: string | undefined;
	device: boolean | undefined;
	silentAuth: boolean;
	requestedActionOrSelector?: boolean;
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

// This functions manages slight mismatches like -srz and returns it as --srz
const processArgv = () => {
	const argv = [];
	const arrayFlags = args.filter((a) => a.type === 'array').map((a) => `--${a.name}`);

	for (let i = 0; i < process.argv.length; i++) {
		const arg = process.argv[i];

		if (arg === '--qall=false' || arg === '--qall=true') {
			argv.push(arg === '--qall=false' ? '--no-qall' : '--qall');
			continue;
		}

		if (/^-[a-zA-Z]{2,}$/.test(arg)) {
			const found = args.find((a) => a.name === arg.substring(1) || a.alias === arg.substring(1));
			if (found) {
				argv.push(`--${found.name}`);
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

			argv.push(arg);
			argv.push(col.join(' '));
			i = n - 1;
			continue;
		}

		argv.push(arg);
	}

	return argv;
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
const markActionSelection = (program: Command, parsed: ArgvType) => {
	parsed.tsdExplicit = program.getOptionValueSource('tsd') === 'cli' && parsed.tsd === true;
	parsed.requestedActionOrSelector =
		program.args.length > 0 ||
		args.some((item) => {
			if (!actionSelectors.has(item.name)) return false;
			const option = program.options.find((candidate) => (item.name.length === 1 ? candidate.short === `-${item.name}` : candidate.long === `--${item.name}`));
			if (!option) return false;
			const native = option.attributeName();
			return item.type === 'boolean'
				? parsed[native] === true
				: program.getOptionValueSource(native) === 'cli' || (item.default === undefined && parsed[native] !== undefined);
		});
};

const normalizeParsed = (program: Command, parsed: ArgvType) => {
	for (const item of args) {
		const native = program.options.find((option) => (item.name.length === 1 ? option.short === `-${item.name}` : option.long === `--${item.name}`))?.attributeName();
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

const normalizeCC = (parsed: ArgvType) => {
	const value: unknown = parsed.CC;
	if (value === true || value === 'true') parsed.CC = true;
	else if (value === false || value === 'false') parsed.CC = false;
	else {
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
	const argv = getCommander(cfg, isGUI).parse(processArgv());
	const parsed = argv.opts() as ArgvType;

	normalizeDubLang(parsed, !isGUI && !(parsed.downloadArchive && argv.getOptionValueSource('dubLang') !== 'cli'));
	normalizeCC(parsed);
	normalizeParsed(argv, parsed);
	markActionSelection(argv, parsed);

	if (!isGUI && (process.argv.length <= 2 || parsed.help)) {
		argv.outputHelp();
		process.exit(0);
	}

	argvC = parsed;
	return parsed;
};

const overrideArguments = (cfg: { [key: string]: unknown }, override: Partial<typeof argvC>, isGUI = false) => {
	const argv = getCommander(cfg, isGUI);
	const baseArgv = [...processArgv()];

	for (const [rawKey, val] of Object.entries(override)) {
		if (val === undefined) continue;
		const item = args.find(
			(arg) =>
				arg.name === rawKey ||
				arg.alias === rawKey ||
				argv.options.find((option) => (arg.name.length === 1 ? option.short === `-${arg.name}` : option.long === `--${arg.name}`))?.attributeName() === rawKey
		);
		const key = item?.name ?? rawKey;
		if (typeof val === 'boolean') {
			if (key === 'CC') {
				baseArgv.push('--CC', String(val));
				continue;
			}
			if (!val && key === 'qall') baseArgv.push('--no-qall');
			if (val) baseArgv.push(key.length > 1 ? `--${key}` : `-${key}`);
		} else {
			baseArgv.push(key.length > 1 ? `--${key}` : `-${key}`, String(val));
		}
	}

	const data = argv.parse(baseArgv);
	const parsed = data.opts() as ArgvType;

	normalizeDubLang(parsed, !isGUI);
	normalizeCC(parsed);
	normalizeParsed(data, parsed);
	markActionSelection(data, parsed);

	if (!isGUI && (process.argv.length <= 2 || parsed.help)) {
		argv.outputHelp();
		process.exit(0);
	}

	argvC = parsed;
};

export { appArgv, overrideArguments, getCommander };

const getCommander = (cfg: Record<string, unknown>, isGUI: boolean) => {
	const program = new Command();
	program
		.name(process.platform === 'win32' ? 'aniDL.exe' : 'aniDL')
		.description(pj.description)
		.version(pj.version, '-v, --version', 'Show version')
		.allowUnknownOption(false)
		.allowExcessArguments(true);

	const data = args.map((a) => {
		return {
			...a,
			demandOption: !isGUI && a.demandOption,
			group: groups[a.group],
			default: configuredDefault(a, cfg)
		};
	});

	for (const item of data) {
		const option = program.createOption(
			(item.alias
				? `${item.alias.length === 1 ? `-${item.alias}` : `--${item.alias}`}, ${item.name.length === 1 ? `-${item.name}` : `--${item.name}`}`
				: item.name.length === 1
					? `-${item.name}`
					: `--${item.name}`) + (item.name === 'CC' ? ' [value]' : item.type === 'boolean' ? '' : ` <value>`),
			item.describe ?? ''
		);
		if (item.default !== undefined) option.default(item.transformer ? item.transformer(item.default as any) : item.default);

		const optionNames = [...args.map((a) => `--${a.name}`), ...args.map((a) => (a.alias ? `-${a.alias}` : null)).filter(Boolean)];

		option.argParser((value) => {
			if (item.name === 'CC') return value;
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
				return !metadata || metadata.service.includes('all') || (!!selected && metadata.service.includes(selected as 'crunchy' | 'hidive' | 'adn'));
			});
		},
		optionDescription(option) {
			const selected = program.opts().service;
			const original = option.description;
			if (selected !== 'crunchy' && ['--auth', '--username', '--password'].includes(option.long ?? ''))
				option.description = original.replace(/ \(Crunchyroll CLI: [^)]+\)$/, '');
			const result = Help.prototype.optionDescription.call(this, option);
			option.description = original;
			return result;
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
