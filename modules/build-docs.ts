import packageJSON from '../package.json';
import fs from 'fs';
import path from 'path';
import { args, cliServices, groups, optionAppliesToService } from './module.args';
import { displayVersion } from './module.fork-display';

const serviceLabels: Record<(typeof cliServices)[number], string> = {
	crunchy: 'Crunchyroll',
	hidive: 'HIDIVE',
	adn: 'ADN'
};

const transformService = (services: Array<'crunchy' | 'hidive' | 'adn' | 'all'>) => {
	if (services.includes('all')) return 'All services';
	return services.map((service) => serviceLabels[service]).join(', ');
};

const intro = `# ${packageJSON.name} v${displayVersion(packageJSON)}

[🚀 Getting started](GET-STARTED.md) · [🔑 Sign in to a service](AUTHENTICATION.md) · [Report an issue](https://github.com/${packageJSON.fork.repository}/issues)

Run a service command as \`aniDL --service <name> <options>\`, using \`crunchy\`, \`hidive\` or \`adn\`. The global list covers all three services. Open a service section for its additional options.

For general help, run \`aniDL --help\`. For service-specific help, use \`aniDL --service crunchy --help\`, \`aniDL --service hidive --help\` or \`aniDL --service adn --help\`. [Crunchyroll options](#crunchyroll-only-commands-and-options) · [HIDIVE options](#hidive-commands-and-options) · [ADN options](#adn-commands-and-options)

## Legal Warning

This application is not endorsed by or affiliated with *Crunchyroll*, *HIDIVE* or *AnimationDigitalNetwork*.
This application enables you to download videos for offline viewing which may be forbidden by law in your country.
The usage of this application may also cause a violation of the *Terms of Service* between you and the stream provider.
This tool is not responsible for your actions; please make an informed decision before using this application.

## CLI Options

### Legend

- \`\${someText}\` shows that you should replace this text with your own.
  - For example: \`--username \${someText}\` → \`--username Izuco\`.

Quality-list rates use decimal \`kb/s\` (1 kb/s = 1,000 bits/s). \`KiB/s\` measures 1,024 bytes/s. Manifest bandwidth is an advertised rate and may differ from a file's measured average.

## Global options

These options apply across services. Start the command with the service selector when required, for example \`aniDL --service hidive --auth\`.

#### \`-v, --version\`

Print the application version. Put the service selector first, for example \`aniDL --service crunchy --version\`.
`;

const renderOptions = (options: typeof args, service?: string) => {
	let docs = '';
	Object.entries(groups).forEach(([key, value]) => {
		const groupArgs = options.filter((argument) => argument.group === key);
		if (!groupArgs.length) return;
		docs += `\n\n### ${value.slice(0, -1)}\n`;

		docs += groupArgs
			.map((argument) => {
				const flag = (argument.name.length > 1 ? '--' : '-') + argument.name;
				const usage = [service ? `--service ${service}` : '', flag, argument.usage].filter(Boolean).join(' ');
				const columns = [
					'**Service**',
					'**Usage**',
					'**Type**',
					'**Required**',
					'**Alias**',
					...(argument.choices ? ['**Choices**'] : []),
					...(argument.default !== undefined ? ['**Default**'] : []),
					'**cli-default Entry**'
				];
				const separator = columns.map(() => '---');
				const defaultValue =
					argument.default === undefined
						? undefined
						: typeof argument.default === 'object'
							? Array.isArray(argument.default)
								? JSON.stringify(argument.default)
								: (argument.default as any).default === undefined
									? (argument.defaultLabel ?? 'undefined')
									: (argument.default as any).default
							: argument.default;
				let configEntry = '`—`';
				if (typeof argument.default === 'object' && !Array.isArray(argument.default)) {
					const key = argument.default.name || argument.name;
					const keys = argument.alias && argument.alias !== key ? [key, argument.alias] : [key];
					configEntry = keys.map((key) => `\`${key}: \``).join(' or ');
				}
				const cells = [
					transformService(argument.service),
					`\`${usage}\``,
					`\`${argument.type}\``,
					`\`${argument.demandOption ? 'Yes' : 'No'}\``,
					`\`${(argument.alias ? `${argument.alias.length > 1 ? '--' : '-'}${argument.alias}` : undefined) ?? '—'}\``,
					...(argument.choices ? [`[${argument.choices.map((choice) => `\`${choice || "''"}\``).join(', ')}]`] : []),
					...(argument.default !== undefined ? [`\`${defaultValue}\``] : []),
					configEntry
				];
				return [
					`#### \`${flag}\``,
					'',
					`| ${columns.join(' | ')} |`,
					`| ${separator.join(' | ')} |`,
					`| ${cells.join(' | ')} |`,
					'',
					argument.docDescribe === true ? argument.describe : argument.docDescribe
				].join('\n');
			})
			.join('\n');
	});
	return docs;
};

const globalOptions = args.filter((option) => optionAppliesToService(option));
const providerSections = cliServices.map((service) => {
	const label = serviceLabels[service];
	const options = args.filter((option) => !option.service.includes('all') && optionAppliesToService(option, service));
	return `<a id="${service === 'crunchy' ? 'crunchyroll-only-commands-and-options' : `${service}-commands-and-options`}"></a>

## ${label} options

<details>
<summary>Show options for <code>--service ${service}</code> (${label})</summary>

Use \`--service ${service}\` before these options. For the full help on your computer, run \`aniDL --service ${service} --help\`.
${service === 'crunchy' ? '\n[🔑 Crunchyroll sign-in walkthroughs](AUTHENTICATION.md#crunchyroll)\n' : ''}
${renderOptions(options, service)}

</details>`;
});

const docs = `${intro}${renderOptions(globalOptions)}

${providerSections.join('\n\n')}

[Back to the CLI walkthrough](GET-STARTED.md)
`;

fs.writeFileSync(path.resolve(__dirname, '..', 'docs', 'ARGUMENTS.md'), docs);
