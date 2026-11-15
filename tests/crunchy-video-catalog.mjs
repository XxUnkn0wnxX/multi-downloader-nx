import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import output from 'node:console';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const modulePath = path.join(root, 'modules/module.crunchy-video-catalog.ts');
const code = ts.transpileModule(fs.readFileSync(modulePath, 'utf8'), {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports, require, URL, console: output }, { filename: modulePath });
const catalog = module.exports;
const source = (guid = 'source-a', languageCode = 'jpn', locale = languageCode === 'eng' ? 'en-US' : 'ja-JP') => ({ guid, locale, languageCode });
const manifestUrl = 'https://example.test/catalog/manifest.mpd?sig=synthetic';
assert.deepEqual(JSON.parse(JSON.stringify(catalog.VIDEO_SELECTION_DEFAULTS)), {
	requestTimeoutMs: 15000,
	discoveryTimeoutMs: 90000,
	maxVersions: 32,
	maxManifestBytes: 2 * 1024 * 1024,
	startToleranceFrames: 1,
	endToleranceFrames: 1,
	durationToleranceFrames: 1,
	maxFrameRateDriftFrames: 1
});

function videoManifest({
	duration = 'PT10S',
	periodStart,
	periodDuration,
	fps = '24000/1001',
	baseUrl = 'https://cdn.example.test/video/',
	baseChoices,
	width = 1920,
	height = 1080,
	bandwidth = 9606000,
	id = 'video-main',
	codecs = 'avc1.640028',
	addressing = '<SegmentBase indexRange="100-300"><Initialization range="0-99"/></SegmentBase>',
	otherRepresentations = ''
} = {}) {
	const base = baseChoices ? baseChoices.map(({ service, url }) => `<BaseURL serviceLocation="${service}">${url}</BaseURL>`).join('') : `<BaseURL>${baseUrl}</BaseURL>`;
	const start = periodStart ? ` start="${periodStart}"` : '';
	const periodDurationAttr = periodDuration ? ` duration="${periodDuration}"` : '';
	return `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="${duration}">${base}<Period${start}${periodDurationAttr}><AdaptationSet mimeType="video/mp4" frameRate="${fps}"><Representation id="${id}" bandwidth="${bandwidth}" width="${width}" height="${height}" codecs="${codecs}">${addressing}</Representation>${otherRepresentations}</AdaptationSet></Period></MPD>`;
}

function descriptor(overrides = {}) {
	return {
		source: source(),
		family: 'Current',
		representationKey: 'key-a',
		width: 1920,
		height: 1080,
		bandwidth: 9606000,
		codecs: 'avc1',
		server: 'cdn.example.test',
		serverOrdinal: 1,
		periodOrdinal: 1,
		adaptationOrdinal: 1,
		representationOrdinal: 1,
		...overrides
	};
}

function check(result, message) {
	assert.equal(result.compatible, true, result.reason ?? message);
}

const currentXml = videoManifest();
const current = catalog.inspectVideoManifest(currentXml, source(), 'Current', manifestUrl);
assert.equal(current.length, 1);
assert.equal(current[0].timing?.periodStart, 0);
assert.equal(current[0].timing?.periodDuration, 10);
assert.equal(current[0].timing?.fps, 24000 / 1001);
assert.equal(current[0].server, 'cdn.example.test');
assert.deepEqual(Array.from(current[0].baseUrlOrdinals), [1, 0, 0, 0]);
assert(!JSON.stringify(current).includes('sig=synthetic'));

const sidx = videoManifest({ addressing: '<BaseURL>movie-sidx.mp4</BaseURL><SegmentBase indexRange="100-300"><Initialization range="0-99"/></SegmentBase>' });
const sidxCatalog = catalog.inspectVideoManifest(sidx, source(), 'Current', manifestUrl);
assert.equal(sidxCatalog.length, 1, 'metadata-only SIDX track should be cataloged without segment expansion or HEAD');
assert.equal(sidxCatalog[0].timing?.addressing, 'SegmentBase');
const stableKeyA = catalog.inspectVideoManifest(videoManifest({ baseUrl: 'https://cdn.example.test/video/?sig=first' }), source(), 'Current', manifestUrl)[0];
const stableKeyB = catalog.inspectVideoManifest(videoManifest({ baseUrl: 'https://cdn.example.test/video/?sig=second' }), source(), 'Current', manifestUrl)[0];
assert.equal(stableKeyA.representationKey, stableKeyB.representationKey, 'signed query changes do not change the reacquisition identity');
const templateKey = (token) =>
	catalog.inspectVideoManifest(
		videoManifest({
			addressing: `<SegmentTemplate timescale="1" media="segments/$Number$.m4s?sig=${token}" initialization="init.mp4?sig=${token}" index="index.sidx?sig=${token}"><SegmentTimeline><S t="0" d="10"/></SegmentTimeline></SegmentTemplate>`
		}),
		source(),
		'Current',
		manifestUrl
	)[0].representationKey;
assert.equal(templateKey('first'), templateKey('second'), 'all URL-valued addressing attributes are query-normalized in identity only');
const listKey = (token) =>
	catalog.inspectVideoManifest(
		videoManifest({
			addressing: `<SegmentList><Initialization sourceURL="init.mp4?sig=${token}"/><SegmentURL media="segment.m4s?sig=${token}" index="index.sidx?sig=${token}"/></SegmentList>`
		}),
		source(),
		'Current',
		manifestUrl
	)[0].representationKey;
assert.equal(listKey('first'), listKey('second'), 'SegmentList URL-valued attributes are query-normalized in identity only');

const inherited = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S"><BaseURL>https://cdn.example.test/root/</BaseURL><Period><AdaptationSet mimeType="video/mp4" frameRate="24/1"><BaseURL>video/</BaseURL><Representation id="inherited" bandwidth="1000000" width="1280" height="720"><BaseURL>representation.bin</BaseURL><SegmentBase indexRange="10-90"/></Representation></AdaptationSet></Period></MPD>`;
const inheritedEntry = catalog.inspectVideoManifest(inherited, source(), 'Current', manifestUrl)[0];
assert.equal(inheritedEntry.server, 'cdn.example.test');
assert(inheritedEntry.representationKey.includes('/root/video/representation.bin'));
assert.equal(inheritedEntry.timing?.fps, 24);
assert.equal(inheritedEntry.timing?.timescale, 1);
assert.equal(inheritedEntry.timing?.presentationTimeOffset, 0);

const alternatives = videoManifest({
	baseChoices: [
		{ service: 'cdn-a', url: 'https://a.example.test/a/' },
		{ service: 'cdn-b', url: 'https://b.example.test/b/' }
	]
});
assert.equal(catalog.inspectVideoManifest(alternatives, source(), 'Legacy 0', manifestUrl, 2)[0].server, 'cdn-b');
assert.equal(catalog.inspectVideoManifest(alternatives, source(), 'Legacy 0', manifestUrl, 99)[0].server, 'cdn-a');
const sameServicePaths = videoManifest({
	baseChoices: [
		{ service: 'shared-cdn', url: 'https://cdn.example.test/path-a/' },
		{ service: 'shared-cdn', url: 'https://cdn.example.test/path-b/' }
	]
});
const sameServiceEntries = catalog.inspectVideoManifest(sameServicePaths, source(), 'Legacy 0', manifestUrl);
assert.equal(sameServiceEntries.length, 2, 'same-host BaseURLs with one serviceLocation but distinct paths remain separate catalog entries');
assert.notEqual(sameServiceEntries[0].representationKey, sameServiceEntries[1].representationKey);
assert.deepEqual(Array.from(sameServiceEntries[0].baseUrlOrdinals), [1, 0, 0, 0]);
assert.deepEqual(Array.from(sameServiceEntries[1].baseUrlOrdinals), [2, 0, 0, 0]);
const sameServiceReordered = videoManifest({
	baseChoices: [
		{ service: 'shared-cdn', url: 'https://cdn.example.test/path-b/' },
		{ service: 'shared-cdn', url: 'https://cdn.example.test/path-a/' }
	]
});
const freshA = catalog
	.inspectVideoManifest(sameServiceReordered, source(), 'Legacy 0', manifestUrl)
	.find((entry) => entry.representationKey === sameServiceEntries[0].representationKey);
assert.deepEqual(Array.from(freshA.baseUrlOrdinals), [2, 0, 0, 0], 'a stable key resolves to the reordered resource with its fresh BaseURL ordinal');
const invalidBaseUrls = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S"><BaseURL>http://[broken</BaseURL><Period><AdaptationSet mimeType="video/mp4" frameRate="24"><Representation id="route" bandwidth="1000000" width="1280" height="720"><SegmentBase/></Representation></AdaptationSet></Period></MPD>`;
assert.equal(catalog.inspectVideoManifest(invalidBaseUrls, source(), 'Current', manifestUrl).length, 0, 'explicit invalid BaseURLs do not silently inherit the manifest URL');
const validBaseSibling = invalidBaseUrls.replace(
	'<BaseURL>http://[broken</BaseURL>',
	'<BaseURL>http://[broken</BaseURL><BaseURL serviceLocation="valid">https://valid.example.test/video/</BaseURL>'
);
const validSiblingEntry = catalog.inspectVideoManifest(validBaseSibling, source(), 'Current', manifestUrl)[0];
assert.equal(validSiblingEntry.server, 'valid');
assert.deepEqual(Array.from(validSiblingEntry.baseUrlOrdinals), [2, 0, 0, 0], 'invalid BaseURL siblings still occupy their original ordinal');
const allLevels = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S"><BaseURL>https://cdn.example.test/root/</BaseURL><Period><BaseURL>period/</BaseURL><AdaptationSet mimeType="video/mp4" frameRate="24"><BaseURL>adaptation/</BaseURL><Representation id="all-levels" bandwidth="1000000" width="1280" height="720"><BaseURL>representation.mp4</BaseURL><SegmentBase/></Representation></AdaptationSet></Period></MPD>`;
const allLevelEntry = catalog.inspectVideoManifest(allLevels, source(), 'Current', manifestUrl)[0];
assert.deepEqual(Array.from(allLevelEntry.baseUrlOrdinals), [1, 1, 1, 1]);
const noBaseUrlEntry = catalog.inspectVideoManifest(
	`<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S"><Period><AdaptationSet mimeType="video/mp4" frameRate="24"><Representation id="none" bandwidth="1000000" width="1280" height="720"><SegmentBase/></Representation></AdaptationSet></Period></MPD>`,
	source(),
	'Current',
	manifestUrl
)[0];
assert.deepEqual(Array.from(noBaseUrlEntry.baseUrlOrdinals), [0, 0, 0, 0]);
const duplicateBase = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S"><BaseURL serviceLocation="same">https://cdn.example.test/shared/</BaseURL><BaseURL serviceLocation="same">https://cdn.example.test/shared/</BaseURL><Period><AdaptationSet mimeType="video/mp4" frameRate="24"><Representation id="shared" bandwidth="1000000" width="1280" height="720"><SegmentBase/></Representation></AdaptationSet></Period></MPD>`;
const duplicateBaseEntries = catalog.inspectVideoManifest(duplicateBase, source(), 'Current', manifestUrl);
assert.equal(duplicateBaseEntries.length, 1, 'identical resolved routes are deterministically deduplicated');
assert.deepEqual(Array.from(duplicateBaseEntries[0].baseUrlOrdinals), [1, 0, 0, 0], 'deduplication keeps the first valid lineage');

const timeline = (items, duration = 'PT4S', fps = '24/1') =>
	videoManifest({
		duration,
		fps,
		addressing: `<SegmentTemplate timescale="1" media="seg-$Number$.m4s" initialization="init.m4s"><SegmentTimeline>${items}</SegmentTimeline></SegmentTemplate>`
	});
const validTimeline = catalog.inspectVideoManifest(timeline('<S t="0" d="1" r="3"/>'), source(), 'Legacy 0', manifestUrl)[0];
assert.equal(validTimeline.timing?.timelineStart, 0);
assert.equal(validTimeline.timing?.timelineEnd, 4);
const repeatedTimeline = catalog.inspectVideoManifest(timeline('<S t="0" d="1" r="-1"/><S t="3" d="1"/>'), source(), 'Legacy 1', manifestUrl)[0];
assert.equal(repeatedTimeline.timing?.timelineEnd, 4);
const ptoTimeline = catalog.inspectVideoManifest(
	videoManifest({
		duration: 'PT4S',
		fps: '24/1',
		addressing:
			'<SegmentTemplate timescale="1000" presentationTimeOffset="1000" media="seg-$Number$.m4s"><SegmentTimeline><S t="1000" d="1000" r="3"/></SegmentTimeline></SegmentTemplate>'
	}),
	source('pto'),
	'Legacy 0',
	manifestUrl
)[0];
assert.equal(ptoTimeline.timing?.timelineStart, 0, 'timeline ticks normalize through PTO and timescale');
assert.equal(catalog.timingCompatible(ptoTimeline, [validTimeline]).compatible, true, 'equivalent normalized timelines may use independent PTO counters');
const shiftedBoundary = (tick) =>
	catalog.inspectVideoManifest(
		videoManifest({
			duration: 'PT4S',
			fps: '24/1',
			addressing: `<SegmentTemplate timescale="1000" media="seg-$Number$.m4s"><SegmentTimeline><S t="${tick}" d="1000" r="3"/></SegmentTimeline></SegmentTemplate>`
		}),
		source(`shift-${tick}`),
		'Legacy 0',
		manifestUrl
	)[0];
const nearStartA = shiftedBoundary(-38);
const nearStartB = shiftedBoundary(38);
assert(nearStartA.timing && nearStartB.timing, 'each timeline stays within one frame of its declared Period');
assert.equal(
	catalog.timingCompatible(nearStartA, [nearStartB]).compatible,
	false,
	'pairwise timelines 1.8 frames apart must fail even when each is individually near the Period boundary'
);
const gappedTimeline = catalog.inspectVideoManifest(timeline('<S t="0" d="1" r="1"/><S t="3" d="1"/>'), source(), 'Legacy 0', manifestUrl)[0];
assert.equal(gappedTimeline.timing, undefined);
assert.match(gappedTimeline.timingIssue, /gap/);
const shiftedTimeline = catalog.inspectVideoManifest(timeline('<S t="1" d="1" r="3"/>'), source(), 'Legacy 0', manifestUrl)[0];
assert.equal(shiftedTimeline.timing, undefined);
assert.match(shiftedTimeline.timingIssue, /start/);
const shortTimeline = catalog.inspectVideoManifest(timeline('<S t="0" d="1" r="2"/>'), source(), 'Legacy 0', manifestUrl)[0];
assert.equal(shortTimeline.timing, undefined);
assert.match(shortTimeline.timingIssue, /end/);
const overlappedTimeline = catalog.inspectVideoManifest(timeline('<S t="0" d="1" r="2"/><S t="2" d="1"/>'), source(), 'Legacy 0', manifestUrl)[0];
assert.equal(overlappedTimeline.timing, undefined);
assert.match(overlappedTimeline.timingIssue, /overlap/);
const malformedTimeline = catalog.inspectVideoManifest(timeline('<S t="0" d="0" r="3"/>'), source(), 'Legacy 0', manifestUrl)[0];
assert.equal(malformedTimeline.timing, undefined);
const unlocatedPto = catalog.inspectVideoManifest(
	videoManifest({ duration: 'PT4S', fps: '24/1', addressing: '<SegmentTemplate timescale="1000" duration="1000" presentationTimeOffset="1000" media="segment-$Number$.m4s"/>' }),
	source('unlocated-pto'),
	'Legacy 0',
	manifestUrl
)[0];
assert.equal(unlocatedPto.timing, undefined, 'a non-zero PTO without timeline entries cannot establish normalized boundaries');
const fixedTemplateTiming = (duration) =>
	catalog.inspectVideoManifest(
		videoManifest({ duration: 'PT4S', fps: '24/1', addressing: `<SegmentTemplate timescale="1" duration="${duration}" media="segment-$Number$.m4s"/>` }),
		source(`fixed-${duration}`),
		'Legacy 0',
		manifestUrl
	)[0];
assert(fixedTemplateTiming('1').timing, 'positive integer SegmentTemplate duration ticks provide timing');
for (const duration of ['1.5', '9007199254740992', '']) {
	assert.equal(fixedTemplateTiming(duration).timing, undefined, `invalid fixed duration ticks are unknown: ${duration}`);
}
const invalidTimelineAttributes = ['<S t="" d="1"/>', '<S t="0" d="1.5"/>', '<S t="0" d="1" r=""/>', '<S t="9007199254740990" d="2" r="1"/>'];
for (const entry of invalidTimelineAttributes) {
	const invalid = catalog.inspectVideoManifest(timeline(entry), source(`invalid-${entry}`), 'Legacy 0', manifestUrl)[0];
	assert.equal(invalid.timing, undefined, `unsafe or malformed timeline ticks are rejected: ${entry}`);
}

const compatibleFps = catalog.inspectVideoManifest(videoManifest({ duration: 'PT1000S', fps: '2997/125' }), source('legacy'), 'Legacy 0', manifestUrl)[0];
const longReference = catalog.inspectVideoManifest(videoManifest({ duration: 'PT1000S' }), source('ref'), 'Current', manifestUrl)[0];
check(catalog.timingCompatible(compatibleFps, [longReference]), 'rounding-level frame-rate delta should fit within one frame');
assert.equal(
	catalog.timingCompatible(compatibleFps, [longReference, catalog.inspectVideoManifest(videoManifest({ duration: 'PT999S' }), source('second-ref'), 'Current', manifestUrl)[0]])
		.compatible,
	false,
	'candidate must match every requested reference'
);
const exact24 = catalog.inspectVideoManifest(videoManifest({ duration: 'PT1000S', fps: '24/1' }), source('exact24'), 'Legacy 1', manifestUrl)[0];
assert.equal(catalog.timingCompatible(exact24, [longReference]).compatible, false, '24 fps and 23.976 fps diverge beyond one frame over a long episode');
const short = catalog.inspectVideoManifest(videoManifest({ duration: 'PT999S' }), source('short'), 'Legacy 0', manifestUrl)[0];
assert.equal(catalog.timingCompatible(short, [longReference]).compatible, false);
assert.equal(catalog.timingCompatible(short, [longReference]).driftSeconds, 1);
const fpsDrift = catalog.timingCompatible(exact24, [longReference]).driftSeconds;
assert(Math.abs(fpsDrift - Math.abs(24 - 24000 / 1001) * 1000 * (1001 / 24000)) < 1e-9);

const offset = catalog.inspectVideoManifest(videoManifest({ duration: 'PT1001S', periodStart: 'PT1S', periodDuration: 'PT1000S' }), source('offset'), 'Legacy 0', manifestUrl)[0];
assert.equal(catalog.timingCompatible(offset, [longReference]).compatible, false);
const inconsistent = catalog.inspectVideoManifest(videoManifest({ duration: 'PT1000S', periodDuration: 'PT999S' }), source('inconsistent'), 'Legacy 0', manifestUrl)[0];
assert.equal(inconsistent.timing, undefined, 'conflicting MPD and Period durations are not treated as interpretable timing');
const malformedPeriod = catalog.inspectVideoManifest(videoManifest().replace('<Period>', '<Period duration="">'), source('malformed-period'), 'Legacy 0', manifestUrl)[0];
assert.equal(malformedPeriod.timing, undefined, 'an explicit malformed Period duration cannot fall back to the MPD duration');
const unknown = catalog.inspectVideoManifest(videoManifest({ duration: '', fps: '' }), source('unknown'), 'Legacy 0', manifestUrl)[0];
assert.equal(unknown.timing, undefined);
assert.equal(catalog.timingCompatible(unknown, [longReference]).compatible, false);
const multiplePeriods = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S"><Period duration="PT5S"><AdaptationSet mimeType="video/mp4" frameRate="24"><Representation id="a" width="1280" height="720" bandwidth="1000000"><SegmentBase/></Representation></AdaptationSet></Period><Period start="PT5S" duration="PT5S"><AdaptationSet mimeType="video/mp4" frameRate="24"><Representation id="b" width="1280" height="720" bandwidth="1000000"><SegmentBase/></Representation></AdaptationSet></Period></MPD>`;
const multiPeriodCatalog = catalog.inspectVideoManifest(multiplePeriods, source('multi'), 'Legacy 1', manifestUrl);
assert.equal(multiPeriodCatalog.length, 0, 'multi-period manifests cannot be materialized as a single representation');
assert.equal(catalog.inspectVideoManifest(videoManifest().replace('type="static"', 'type="dynamic"'), source('dynamic'), 'Current', manifestUrl).length, 0);
assert.equal(catalog.inspectVideoManifest(videoManifest().replace('type="static"', 'type=""'), source('empty-type'), 'Current', manifestUrl).length, 0);
assert.equal(catalog.inspectVideoManifest(videoManifest().replace(' type="static"', ''), source('implicit-static'), 'Current', manifestUrl).length, 1);
assert.equal(catalog.inspectVideoManifest(videoManifest({ fps: '' }), source('missing-fps'), 'Current', manifestUrl).length, 1);

const multipleEncodes = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S"><Period><AdaptationSet mimeType="video/mp4" frameRate="24"><Representation id="a" bandwidth="1000000" width="1280" height="720" codecs="avc1"><BaseURL>a.mp4</BaseURL><SegmentBase/></Representation><Representation id="b" bandwidth="1000000" width="1280" height="720" codecs="hev1"><BaseURL>b.mp4</BaseURL><SegmentBase/></Representation></AdaptationSet></Period></MPD>`;
const encodes = catalog.inspectVideoManifest(multipleEncodes, source(), 'Current', manifestUrl);
assert.equal(encodes.length, 2);
assert.equal(encodes[0].representationId, 'a');
assert.notEqual(encodes[0].representationKey, encodes[1].representationKey, 'different encodes must not deduplicate by resolution and bandwidth');
const emptyId = catalog.inspectVideoManifest(multipleEncodes.replace('id="a"', 'id=""'), source(), 'Current', manifestUrl)[0];
assert.equal(emptyId.representationId, 'p1a1r1', 'missing or empty ids use stable positional identity fallback');
const reorderXml = (ids) =>
	`<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S"><Period><AdaptationSet mimeType="video/mp4" frameRate="24">${ids
		.map((id) => `<Representation id="${id}" bandwidth="1000000" width="1280" height="720"><BaseURL>${id}.mp4</BaseURL><SegmentBase/></Representation>`)
		.join('')}</AdaptationSet></Period></MPD>`;
const reorderedA = catalog.inspectVideoManifest(reorderXml(['a', 'b']), source(), 'Current', manifestUrl).find((entry) => entry.representationId === 'a');
const reorderedBA = catalog.inspectVideoManifest(reorderXml(['b', 'a']), source(), 'Current', manifestUrl).find((entry) => entry.representationId === 'a');
assert.equal(reorderedA?.representationKey, reorderedBA?.representationKey, 'opaque identity is stable when representation XML order changes');
assert.notEqual(reorderedA?.representationOrdinal, reorderedBA?.representationOrdinal, 'fresh ordinals provide a locator after representation reordering');

const candidates = [
	descriptor({ representationKey: 'low', width: 640, height: 360, bandwidth: 1000000 }),
	descriptor({ source: source('preferred'), representationKey: 'preferred', width: 1280, height: 720, bandwidth: 2000000 }),
	descriptor({ source: source('other'), family: 'Legacy 0', representationKey: 'other', width: 1280, height: 720, bandwidth: 2000000 }),
	descriptor({ representationKey: 'higher-bw', width: 1280, height: 720, bandwidth: 3000000 }),
	descriptor({ representationKey: 'highest', width: 1920, height: 1080, bandwidth: 4000000 })
];
const ranked = catalog.rankVideoCandidates(candidates, ['preferred']);
assert.deepEqual(
	ranked.map((entry) => entry.representationKey),
	['low', 'other', 'preferred', 'higher-bw', 'highest'],
	'q=0 can select the last entry after ascending resolution, bandwidth, and requested-source tie preference'
);
assert.equal(catalog.formatVideoCandidate(candidates[1]), '1280x720 (2000 kb/s) [Current M] [jpn]');
assert.equal(catalog.formatVideoCandidate(descriptor({ source: source('english', 'eng'), bandwidth: 9606297 })), '1920x1080 (9606 kb/s) [Current M] [eng]');
assert.equal(catalog.formatVideoCandidate(descriptor({ family: 'Legacy 1', source: source('old', 'eng'), bandwidth: 9606297 })), '1920x1080 (9606 kb/s) [Legacy M] [eng]');
const groupedQualities = catalog.formatGroupedVideoQualities([
	...ranked.map((entry) => ({ height: entry.height, text: catalog.formatVideoCandidate(entry) })),
	{ text: 'unknown height' }
]);
assert.equal(
	groupedQualities,
	[
		'    360p',
		'        [1] 640x360 (1000 kb/s) [Current M] [jpn]',
		'    720p',
		'        [2] 1280x720 (2000 kb/s) [Legacy M] [jpn]',
		'        [3] 1280x720 (2000 kb/s) [Current M] [jpn]',
		'        [4] 1280x720 (3000 kb/s) [Current M] [jpn]',
		'    1080p',
		'        [5] 1920x1080 (4000 kb/s) [Current M] [jpn]',
		'    Other',
		'        [6] unknown height'
	].join('\n')
);
assert.equal(ranked.at(-1)?.representationKey, 'highest', 'quality 0 remains the highest-ranked entry after formatting');
const q0Qualities = catalog.formatGroupedVideoQualities(
	[...ranked.map((entry) => ({ height: entry.height, text: catalog.formatVideoCandidate(entry) })), { text: 'unknown height' }],
	ranked.length - 1
);
assert(q0Qualities.includes('        [5] 1920x1080 (4000 kb/s) [Current M] [jpn] <-- Selected'));
assert(!q0Qualities.includes('        [6] unknown height <-- Selected'));
const explicitQualities = catalog.formatGroupedVideoQualities(
	ranked.map((entry) => ({ height: entry.height, text: catalog.formatVideoCandidate(entry) })),
	1
);
assert(explicitQualities.includes('        [2] 1280x720 (2000 kb/s) [Legacy M] [jpn] <-- Selected'));
assert.equal(catalog.formatVideoQualityRow(2, 'quality label', 'Discarded'), '        [2] quality label <-- Discarded');
assert.equal(catalog.formatVideoQualityRow(5, 'quality label', 'Re-selected'), '        [5] quality label <-- Re-selected');

const manyRepresentations = Array.from(
	{ length: 105 },
	(_, index) => `<Representation id="r${index}" bandwidth="1000000" width="640" height="360" codecs="avc1"><BaseURL>r${index}.mp4</BaseURL><SegmentBase/></Representation>`
).join('');
const overHundred = catalog.inspectVideoManifest(
	`<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S"><Period><AdaptationSet mimeType="video/mp4" frameRate="24">${manyRepresentations}</AdaptationSet></Period></MPD>`,
	source(),
	'Current',
	manifestUrl
);
assert.equal(catalog.rankVideoCandidates(overHundred).length, 105);
assert.equal(catalog.rankVideoCandidates(overHundred)[104].representationOrdinal, 105);

const familyManifest = (count, bandwidths, duration, fps) =>
	videoManifest({
		duration,
		fps,
		bandwidth: bandwidths[0],
		otherRepresentations: bandwidths
			.slice(1, count)
			.map(
				(bandwidth, index) =>
					`<Representation id="family-${index + 2}" bandwidth="${bandwidth}" width="1920" height="1080" codecs="avc1"><BaseURL>family-${index + 2}.mp4</BaseURL><SegmentBase/></Representation>`
			)
			.join('')
	});
const currentEn = catalog.inspectVideoManifest(
	familyManifest(4, [9500000, 9600000, 9700000, 9800000], 'PT1420.044S', '24000/1001'),
	source('current-en', 'eng'),
	'Current',
	manifestUrl
);
const currentJa = catalog.inspectVideoManifest(familyManifest(4, [9400000, 9500000, 9600000, 9700000], 'PT1420.044S', '24000/1001'), source('current-ja'), 'Current', manifestUrl);
const oldZero = catalog.inspectVideoManifest(
	familyManifest(5, [10000000, 11000000, 12000000, 13000000, 14240503], 'PT1420.045S', '2997/125'),
	source('old-zero'),
	'Legacy 0',
	manifestUrl
);
const oldOne = catalog.inspectVideoManifest(
	familyManifest(5, [9000000, 9500000, 10000000, 10300000, 10378297], 'PT1420.044S', '24000/1001'),
	source('old-one'),
	'Legacy 1',
	manifestUrl
);
const inventoryShape = [...currentEn, ...currentJa, ...oldZero, ...oldOne];
assert.equal(inventoryShape.length, 18);
const inventoryCompatible = inventoryShape.filter((entry) => catalog.timingCompatible(entry, [currentEn[0], currentJa[0]]).compatible);
assert.equal(inventoryCompatible.length, 18, 'synthetic descriptors preserve the 4+4+5+5 parent-observed timing-compatible shape');
assert.equal(catalog.formatVideoCandidate(catalog.rankVideoCandidates(inventoryShape)[inventoryShape.length - 1]), '1920x1080 (14241 kb/s) [Legacy M] [jpn]');

assert.equal(catalog.inspectVideoManifest('<MPD><broken></MPD>', source(), 'Legacy 0', manifestUrl).length, 0);
assert.equal(catalog.inspectVideoManifest('<MPD/>', source(), 'Current', manifestUrl).length, 0);
output.log('ok - pure Crunchyroll video catalog, timing, ranking and display contracts');
