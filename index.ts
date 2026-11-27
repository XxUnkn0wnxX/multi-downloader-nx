import packageJson from './package.json';
import { forkReleaseUrl } from './modules/module.fork-display';
import { earlyCrunchyCliAuth, crunchyCliAuthDecision } from './modules/module.crunchy-cli-auth';

(async () => {
	const early = earlyCrunchyCliAuth(process.argv.slice(2));
	if (early.kind !== 'continue') {
		(early.kind === 'notice' ? global.console.info : global.console.error)(early.message);
		if (early.kind === 'error') process.exitCode = 1;
		return;
	}
	const [{ console }, { appArgv, overrideArguments, statusInvocation }, yamlCfg] = await Promise.all([
		import('./modules/log'),
		import('./modules/module.app-args'),
		import('./modules/module.cfg-loader')
	]);
	const recoveryBudget = { used: false };
	const status = statusInvocation(process.argv.slice(2));
	if (status === 'invalid') {
		console.error('--check-status requires only --service crunchy and optional --debug');
		process.exitCode = 1;
		return;
	}
	const cliDefaults = yamlCfg.loadCliCfg();
	const argv = appArgv(cliDefaults);
	if (argv.update) {
		console.warn(`Updates disabled on this fork. Download updates: ${forkReleaseUrl(packageJson.fork)}`);
		process.exitCode = 1;
		return;
	}
	if (status !== 'valid') {
		const authDecision = crunchyCliAuthDecision(argv);
		if (authDecision.kind !== 'continue') {
			(authDecision.kind === 'notice' ? console.info : console.error)(authDecision.message);
			if (authDecision.kind === 'error') process.exitCode = 1;
			return;
		}
	}
	const [{ makeCommand, addToArchive }, { default: Crunchy }, { default: Hidive }, { default: ADN }, { default: update }] = await Promise.all([
		import('./modules/module.downloadArchive'),
		import('./crunchy'),
		import('./hidive'),
		import('./adn'),
		import('./modules/module.updater')
	]);
	const SERVICES: Record<string, any> = { crunchy: Crunchy, hidive: Hidive, adn: ADN };
	if (status === 'valid') {
		const service = new Crunchy(false, recoveryBudget, true);
		if (!(await service.cli())) process.exitCode = 1;
		return;
	}
	if (argv.dryRun && (argv.update || argv.addArchive)) {
		console.error('--dry-run cannot be combined with --update or --addArchive.');
		process.exitCode = 1;
		return;
	}
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
	} else if (argv.downloadArchive && argv.service) {
		const ids = makeCommand(argv.service);
		for (const id of ids) {
			overrideArguments(cliDefaults, id);
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
