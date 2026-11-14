import packageJSON from '../package.json';
import fs from 'fs';
import path from 'path';
import { args, groups } from './module.args';

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

let docs = `# ${packageJSON.name} (v${packageJSON.version})

If you find any bugs in this documentation or in the program itself, please report them on [GitHub issues](../../../issues).

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

Object.entries(groups).forEach(([key, value]) => {
	const groupArgs = args.filter((argument) => argument.group === key);
	if (!groupArgs.length) return;
	docs += `\n### ${value.slice(0, -1)}\n`;

	docs += groupArgs
		.map((argument) => {
			return [
				`#### \`${argument.name.length > 1 ? '--' : '-'}${argument.name}\``,
				`| **Service** | **Usage** | **Type** | **Required** | **Alias** | ${argument.choices ? '**Choices** |' : ''} ${argument.default ? '**Default** |' : ''}**cli-default Entry**`,
				`| --- | --- | --- | --- | --- | ${argument.choices ? '--- | ' : ''}${argument.default ? '--- | ' : ''}---|`,
				`| ${transformService(argument.service)} | \`${argument.name.length > 1 ? '--' : '-'}${argument.name} ${argument.usage}\` | \`${argument.type}\` | \`${argument.demandOption ? 'Yes' : 'No'}\`|` +
					` \`${(argument.alias ? `${argument.alias.length > 1 ? '--' : '-'}${argument.alias}` : undefined) ?? '—'}\` |` +
					`${argument.choices ? ` [${argument.choices.map((a) => `\`${a || "''"}\``).join(', ')}] |` : ''}` +
					`${
						argument.default
							? ` \`${
									typeof argument.default === 'object'
										? Array.isArray(argument.default)
											? JSON.stringify(argument.default)
											: (argument.default as any).default
										: argument.default
								}\`|`
							: ''
					}` +
					` ${typeof argument.default === 'object' && !Array.isArray(argument.default) ? `\`${argument.default.name || argument.name}: \`` : '`—`'} |`,
				'',
				argument.docDescribe === true ? argument.describe : argument.docDescribe
			].join('\n');
		})
		.join('\n');
});

fs.writeFileSync(path.resolve(__dirname, '..', 'docs', 'DOCUMENTATION.md'), docs);
