/* Copyright (c) Microsoft Corporation. Licensed under the MIT License. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const directory = process.argv[2];
assert.ok(directory, 'Pass the directory containing verified Windows artifacts');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'build-manifest-win32-x64.json'), 'utf8'));
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.match(manifest.commit, /^[a-f0-9]{40}$/);
assert.equal(manifest.architecture, 'x64');
const assetName = 'ArniCodeSetup.exe';
const data = fs.readFileSync(path.join(directory, assetName));
assert.ok(data.length > 0, 'Installer is empty');
fs.writeFileSync(path.join(directory, 'update-win32-x64.json'), JSON.stringify({
	version: manifest.version,
	commit: manifest.commit,
	platform: 'win32-x64-user',
	assetName,
	sha256: createHash('sha256').update(data).digest('hex'),
	size: data.length,
}, null, 2) + '\n');
console.log('Created Windows update manifest for ' + manifest.version);
