import { console } from './modules/log';
import { appArgv, overrideArguments, statusInvocation } from './modules/module.app-args';
import * as yamlCfg from './modules/module.cfg-loader';
import { makeCommand, addToArchive } from './modules/module.downloadArchive';
import Crunchy from './crunchy';
import { PlaybackRecoveryBudget } from './modules/module.crunchy-playback-recovery';
import Hidive from './hidive';
import ADN from './adn';

import update from './modules/module.updater';
import { CRUNCHY_CLI_AUTH_WARNING, validateCrunchyAuthModes } from './modules/module.crunchy-device-auth';

const SERVICES: Record<string, any> = {
	crunchy: Crunchy,
	hidive: Hidive,
	adn: ADN
};

(async () => {
	const recoveryBudget: PlaybackRecoveryBudget = { used: false };
	const status = statusInvocation(process.argv.slice(2));
	if (status === 'invalid') {
		console.error('--check-status requires only --service crunchy and optional --debug');
		process.exitCode = 1;
		return;
	}
	const cfg = yamlCfg.loadCfg(status === 'valid');
	const argv = appArgv(cfg.cli);
	if (status === 'valid') {
		const service = new Crunchy(false, recoveryBudget, true);
		if (!(await service.cli())) process.exitCode = 1;
		return;
	}
	const authError = validateCrunchyAuthModes(argv);
	if (authError) {
		if (authError === CRUNCHY_CLI_AUTH_WARNING) console.warn(authError);
		else console.error(authError);
		process.exitCode = 1;
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
			overrideArguments(cfg.cli, id);
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
