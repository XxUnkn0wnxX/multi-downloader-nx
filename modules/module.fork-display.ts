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
