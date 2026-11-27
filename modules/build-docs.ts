import packageJSON from '../package.json';
import fs from 'fs';
import path from 'path';
import { args, groups } from './module.args';
import { displayVersion } from './module.fork-display';

const transformService = (str: Array<'crunchy' | 'hidive' | 'adn' | 'all'>) => {
	const services: string[] = [];
	str.forEach(function (part) {
		switch (part) {
			case 'crunchy':
				services.push('Crunchyroll');
				break;
			case 'hidive':
				services.push('Hidive');
				break;
			case 'adn':
				services.push('AnimationDigitalNetwork');
				break;
			case 'all':
				services.push('All');
				break;
		}
	});
	return services.join(', ');
};

const intro = `# ${packageJSON.name} v${displayVersion(packageJSON)}

[🚀 Getting started](GET-STARTED.md) · [🔑 Sign in to a service](AUTHENTICATION.md) · [Report an issue](../../../issues)

Start each service command with \`--service\` and one name (\`crunchy\`, \`hidive\` or \`adn\`). The Service column below shows where each option applies.

For general help, run \`aniDL --help\`. For service-specific help, put the service first, for example \`aniDL --service crunchy --help\`. [📺 Crunchyroll-only commands and options](#crunchyroll-only-commands-and-options)

## Legal Warning

This application is not endorsed by or affiliated with *Crunchyroll*, *Hidive* or *AnimationDigitalNetwork*.
This application enables you to download videos for offline viewing which may be forbidden by law in your country.
The usage of this application may also cause a violation of the *Terms of Service* between you and the stream provider.
This tool is not responsible for your actions; please make an informed decision before using this application.

## CLI Options
### Legend
 - \`\${someText}\` shows that you should replace this text with your own
    - e.g. \`--username \${someText}\` -> \`--username Izuco\`

Quality-list rates use decimal \`kb/s\` (1 kb/s = 1,000 bits/s). \`KiB/s\` measures 1,024 bytes/s. Manifest bandwidth is an advertised rate and may differ from a file's measured average.
`;

const renderOptions = (options: typeof args, servicePrefix = '') => {
	let docs = '';
	Object.entries(groups).forEach(([key, value]) => {
		const groupArgs = options.filter((argument) => argument.group === key);
		if (!groupArgs.length) return;
		docs += `\n### ${value.slice(0, -1)}\n`;

		docs += groupArgs
			.map((argument) => {
				const flag = (argument.name.length > 1 ? '--' : '-') + argument.name;
				const usage = [servicePrefix, flag, argument.usage].filter(Boolean).join(' ');
				return [
					`#### \`${flag}\``,
					`| **Service** | **Usage** | **Type** | **Required** | **Alias** | ${argument.choices ? '**Choices** |' : ''} ${argument.default !== undefined ? '**Default** |' : ''}**cli-default Entry**`,
					`| --- | --- | --- | --- | --- | ${argument.choices ? '--- | ' : ''}${argument.default !== undefined ? '--- | ' : ''}---|`,
					`| ${transformService(argument.service)} | \`${usage}\` | \`${argument.type}\` | \`${argument.demandOption ? 'Yes' : 'No'}\`|` +
						` \`${(argument.alias ? `${argument.alias.length > 1 ? '--' : '-'}${argument.alias}` : undefined) ?? '—'}\` |` +
						`${argument.choices ? ` [${argument.choices.map((a) => `\`${a || "''"}\``).join(', ')}] |` : ''}` +
						`${
							argument.default !== undefined
								? ` \`${
										typeof argument.default === 'object'
											? Array.isArray(argument.default)
												? JSON.stringify(argument.default)
												: (argument.default as any).default === undefined
													? (argument.defaultLabel ?? 'undefined')
													: (argument.default as any).default
											: argument.default
									}\`|`
								: ''
						}` +
						` ${typeof argument.default === 'object' && !Array.isArray(argument.default) ? `\`${argument.default.name || argument.name}: \`${argument.alias && argument.alias !== (argument.default.name || argument.name) ? ` or \`${argument.alias}: \`` : ''}` : '`—`'} |`,
					'',
					argument.docDescribe === true ? argument.describe : argument.docDescribe
				].join('\n');
			})
			.join('\n');
	});
	return docs;
};

const isCrunchyOnly = (option: (typeof args)[number]) => option.service.length === 1 && option.service[0] === 'crunchy';
const mainOptions = args.filter((option) => !isCrunchyOnly(option));
const crunchyOptions = args.filter(isCrunchyOnly);
const docs = `${intro}${renderOptions(mainOptions)}

## Crunchyroll-only commands and options

<details>
<summary>📺 Show options for <code>--service crunchy</code></summary>

These options apply only to Crunchyroll. Use \`--service crunchy\` before the option. For the full help on your computer, run \`aniDL.exe --service crunchy --help\` on Windows or \`./aniDL --service crunchy --help\` on Linux.

[🔑 Crunchyroll sign-in walkthroughs](AUTHENTICATION.md#crunchyroll)
${renderOptions(crunchyOptions, '--service crunchy')}

</details>
`;

fs.writeFileSync(path.resolve(__dirname, '..', 'docs', 'DOCUMENTATION.md'), docs);
