import * as path from 'path';
import * as fs from 'fs';
import type { ArgvType } from './module.app-args';
import { workingDir } from './module.cfg-loader';

export const archiveFile = path.join(workingDir, 'config', 'archive.json');

export type ItemType = {
	id: string;
	already: string[];
}[];

type ArchiveKind = { service: 'crunchy'; type: 's' | 'srz' } | { service: 'hidive' | 'adn'; type: 's' };
type ArchiveLists = Partial<Record<ArchiveKind['type'], ItemType>>;
export type DataType = Partial<Record<ArchiveKind['service'], ArchiveLists>>;

const loadData = (): DataType => {
	if (!fs.existsSync(archiveFile)) return {};
	const contents = fs.readFileSync(archiveFile, 'utf8').trim();
	return contents ? JSON.parse(contents) : {};
};

const addToArchive = (kind: ArchiveKind, id: string, completed: string[] = []) => {
	const data = loadData();
	const lists = (data[kind.service] ??= kind.service === 'crunchy' ? { s: [], srz: [] } : { s: [] });
	const entries = (lists[kind.type] ??= []);
	const entry = entries.find((item) => item.id === id);
	const episodes = [...new Set(completed)];
	if (entry) {
		const additions = episodes.filter((episode) => !entry.already.includes(episode));
		if (!additions.length) return;
		entry.already.push(...additions);
	} else {
		entries.push({ id, already: episodes });
	}
	fs.writeFileSync(archiveFile, JSON.stringify(data, null, 4));
};

const downloaded = (kind: ArchiveKind, id: string, episodes: string[]) => addToArchive(kind, id, episodes);

const makeCommand = (service: ArchiveKind['service']): Partial<ArgvType>[] => {
	const commands: Partial<ArgvType>[] = [];
	for (const [type, entries] of Object.entries(loadData()[service] ?? {})) {
		if (type !== 's' && !(service === 'crunchy' && type === 'srz')) continue;
		for (const entry of entries) {
			commands.push({
				but: true,
				all: false,
				service,
				e: entry.already.join(','),
				s: type === 's' ? entry.id : undefined,
				series: type === 'srz' ? entry.id : undefined
			});
		}
	}
	return commands;
};

export { addToArchive, downloaded, makeCommand };
