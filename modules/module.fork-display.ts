type ForkPackageMetadata = {
	version: string;
	fork?: {
		channel: string;
		revision: number;
	};
};

export function displayVersion(packageMetadata: ForkPackageMetadata): string {
	const { version, fork } = packageMetadata;
	if (!fork) return version;
	if (typeof fork.channel !== 'string' || !fork.channel.trim() || !Number.isSafeInteger(fork.revision) || fork.revision < 1) throw new Error('Invalid fork display metadata');
	return `${version} (${fork.channel}) [Rev${fork.revision}]`;
}

export function forkReleaseUrl(fork: { repository: string; releaseTag: string }): string {
	if (
		typeof fork.repository !== 'string' ||
		typeof fork.releaseTag !== 'string' ||
		!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fork.repository) ||
		!/^[A-Za-z0-9_.-]+$/.test(fork.releaseTag) ||
		[...fork.repository.split('/'), fork.releaseTag].some((part) => /^\.+$/.test(part))
	)
		throw new Error('Invalid fork release metadata');
	return `https://github.com/${fork.repository}/releases/tag/${fork.releaseTag}`;
}
