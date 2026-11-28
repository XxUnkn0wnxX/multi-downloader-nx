import fs from 'fs';
import path from 'path';

export const privateDeviceFile = /\.(?:wvd|cert|pem)$/i;

export function isPublicDocEntry(file: string) {
	if (privateDeviceFile.test(file)) return false;
	const entry = fs.lstatSync(file);
	return entry.isFile() || entry.isDirectory();
}

export function copyWidevineGuides(source: string, destination: string) {
	if (!fs.lstatSync(source).isDirectory()) throw new Error('Expected the public widevine directory when packaging guides.');
	const guides = fs.readdirSync(source, { withFileTypes: true }).filter((entry) => entry.isFile() && !entry.name.startsWith('.') && /\.md$/i.test(entry.name));
	if (!guides.some((entry) => entry.name === 'README.md')) throw new Error('Missing public widevine/README.md.');
	fs.mkdirSync(destination, { recursive: true });
	for (const guide of guides) fs.copyFileSync(path.join(source, guide.name), path.join(destination, guide.name));
}

export function copyReleaseDocs(sourceRoot: string, buildDir: string) {
	const docs = path.join(sourceRoot, 'docs');
	const license = path.join(sourceRoot, 'LICENSE.md');
	if (!fs.lstatSync(docs).isDirectory()) throw new Error('Expected the public docs directory when packaging guides.');
	if (!fs.lstatSync(license).isFile()) throw new Error('Expected a regular LICENSE.md when packaging guides.');
	const destination = path.join(buildDir, 'docs');
	fs.cpSync(docs, destination, { recursive: true, filter: isPublicDocEntry });
	fs.copyFileSync(license, path.join(destination, 'LICENSE.md'));
	copyWidevineGuides(path.join(sourceRoot, 'widevine'), path.join(buildDir, 'widevine'));
}
