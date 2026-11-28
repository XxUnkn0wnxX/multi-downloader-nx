import fs from 'fs';
import path from 'path';
import { fontFamilies } from './module.fontsData';

const redistributableFont = /^(?:DejaVu.*|MeeraInimai-Regular|NotoSans(?:Thai|TamilVariable|TeluguVariable)|Rubik-.*)\.ttf$/;
const bundledFiles = [
	'README.md',
	'DejaVu-LICENSE.txt',
	'OFL.txt',
	...Object.values(fontFamilies)
		.flat()
		.filter((filename) => redistributableFont.test(filename))
];

export function copyBundledFonts(source: string, destination: string) {
	if (!fs.lstatSync(source, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Expected the bundled fonts directory.');
	for (const filename of bundledFiles) {
		const entry = fs.lstatSync(path.join(source, filename), { throwIfNoEntry: false });
		if (!entry?.isFile() || entry.size === 0) throw new Error(`Missing or invalid bundled font asset: ${filename}`);
	}

	fs.mkdirSync(destination, { recursive: true });
	for (const filename of bundledFiles) fs.copyFileSync(path.join(source, filename), path.join(destination, filename));
}
