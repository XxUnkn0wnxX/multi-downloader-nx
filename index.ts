// Capture the window loader's launch environment before configuration loads .env.
import './modules/module.crunchy-phone-runtime';
import packageJson from './package.json';
import { displayVersion, forkReleaseUrl } from './modules/module.fork-display';
import { cliServices } from './modules/module.args';
import { cliInvocation, crunchyCliAuthDecision, leadingCliService } from './modules/module.crunchy-cli-auth';

(async () => {
	const raw = process.argv.slice(2);
	const [first] = raw;
	const helpFlags = ['--help', '-h', '-help'];
	const debugFlags = ['--debug', '-debug'];
	if (raw.every((arg) => helpFlags.includes(arg) || debugFlags.includes(arg))) {
		if (!raw.length || raw.some((arg) => helpFlags.includes(arg))) {
			const { getCommander } = await import('./modules/module.app-args');
			getCommander({}, false).outputHelp();
		}
		if (raw.some((arg) => debugFlags.includes(arg)))
			global.console.info(
				`AniDL ${displayVersion(packageJson)}\nNode ${process.version} | ${process.platform} ${process.arch}\nTo debug a service command, put --service first and add --debug to that command.`
			);
		return;
	}
	const selectedService = leadingCliService(raw);
	if (!selectedService || !cliServices.includes(selectedService)) {
		const message = `Choose a service first. Use --service with exactly one name (${cliServices.join(', ')}).`;
		if (raw.length === 1 && (first === '--auth' || first === '-auth')) global.console.error(message);
		else {
			const example = raw.length === 1 && (first === '--device' || first === '--token') ? first : '--help';
			global.console.error(`${message} For example:\n  ${cliInvocation()} --service crunchy ${example}`);
		}
		process.exitCode = 1;
		return;
	}
	const [{ console }, { appArgv, overrideArguments, statusInvocation }, yamlCfg] = await Promise.all([
		import('./modules/log'),
		import('./modules/module.app-args'),
		import('./modules/module.cfg-loader')
	]);
	const recoveryBudget = { used: false };
	const status = statusInvocation(raw);
	const authStatus = statusInvocation(raw, '--check-auth');
	if (status === 'invalid' || authStatus === 'invalid') {
		console.error(`${authStatus === 'invalid' ? '--check-auth' : '--check-status'} requires only --service crunchy and optional --debug`);
		process.exitCode = 1;
		return;
	}
	const cliDefaults = yamlCfg.loadCliCfg();
	const argv = appArgv(cliDefaults);
	if (status === 'valid' || authStatus === 'valid') {
		const { default: Crunchy } = await import('./crunchy');
		const service = new Crunchy(false, recoveryBudget, true);
		if (!(await service.cli())) process.exitCode = 1;
		return;
	}
	if (argv.update) {
		console.warn(`Updates disabled on this fork. Download updates: ${forkReleaseUrl(packageJson.fork)}`);
		process.exitCode = 1;
		return;
	}
	if (argv.dryRun && argv.addArchive) {
		console.error('--dry-run cannot be combined with --update or --addArchive.');
		process.exitCode = 1;
		return;
	}
	const authDecision = crunchyCliAuthDecision(argv);
	if (authDecision.kind !== 'continue') {
		(authDecision.kind === 'notice' ? console.info : console.error)(authDecision.message);
		if (authDecision.kind === 'error') process.exitCode = 1;
		return;
	}
	const { makeCommand, addToArchive } = await import('./modules/module.downloadArchive');
	const archiveCommands = argv.downloadArchive && !argv.addArchive && !(argv.all && argv.but) ? makeCommand(argv.service) : undefined;
	if (archiveCommands?.length === 0) {
		const name = argv.service === 'crunchy' ? 'Crunchyroll' : argv.service.toUpperCase();
		console.info(`No archived entries for ${name}.`);
		return;
	}
	const [{ default: Crunchy }, { default: Hidive }, { default: ADN }, { default: update }] = await Promise.all([
		import('./crunchy'),
		import('./hidive'),
		import('./adn'),
		import('./modules/module.updater')
	]);
	const SERVICES: Record<string, any> = { crunchy: Crunchy, hidive: Hidive, adn: ADN };
	if (!argv.dryRun && !argv.skipUpdate) await update(argv.update);

	if (argv.all && argv.but) {
		console.error('--all and --but exclude each other!');
		return;
	}

	if (argv.addArchive) {
		if (argv.service === 'crunchy') {
			if (argv.s === undefined && argv.series === undefined) return console.error('`-s` or `--srz` not found');
			if (argv.s && argv.series) return console.error('Both `-s` and `--srz` found');
			addToArchive(
				{
					service: 'crunchy',
					type: argv.s === undefined ? 'srz' : 's'
				},
				(argv.s === undefined ? argv.series : argv.s) as string
			);
			console.info('Added %s to the downloadArchive list', argv.s === undefined ? argv.series : argv.s);
		} else if (argv.service === 'hidive') {
			if (argv.s === undefined) return console.error('`-s` not found');
			addToArchive(
				{
					service: 'hidive',
					//type: argv.s === undefined ? 'srz' : 's'
					type: 's'
				},
				(argv.s === undefined ? argv.series : argv.s) as string
			);
			console.info('Added %s to the downloadArchive list', argv.s === undefined ? argv.series : argv.s);
		}
	} else if (archiveCommands) {
		for (const command of archiveCommands) {
			overrideArguments(cliDefaults, command);
			const Service = SERVICES[argv.service];
			if (!Service) {
				console.error('Unknown service:', argv.service);
				process.exit(1);
			}

			const service = argv.service === 'crunchy' ? new Crunchy(false, recoveryBudget) : new Service();
			const result = await service.cli();
			if (argv.service === 'crunchy' && result === false) {
				process.exitCode = 1;
				break;
			}
		}
	} else if (argv.service) {
		const Service = SERVICES[argv.service];
		if (!Service) {
			console.error('Unknown service:', argv.service);
			process.exit(1);
		}

		const service = argv.service === 'crunchy' ? new Crunchy(false, recoveryBudget) : new Service();
		const result = await service.cli();
		if (argv.service === 'crunchy' && result === false) process.exitCode = 1;
	}
})();
