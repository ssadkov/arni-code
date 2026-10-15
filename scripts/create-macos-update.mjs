/* Copyright (c) Microsoft Corporation. Licensed under the MIT License. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const [arch, directory] = process.argv.slice(2);
if (!['arm64', 'x64'].includes(arch) || !directory || process.env.SIGNING_ENABLED !== 'true') {
	throw new Error('Update manifests require a signed and notarized macOS build');
}
const assetName = `ArniCode-darwin-${arch}.zip`;
const bytes = readFileSync(join(directory, assetName));
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
writeFileSync(join(directory, `update-darwin-${arch}.json`), JSON.stringify({
	version, commit, assetName, sha256: createHash('sha256').update(bytes).digest('hex'),
	signed: true, notarized: true, publishedAt: new Date().toISOString(),
}, null, 2) + '\n');
