/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [app, output, architecture] = process.argv.slice(2);
assert.ok(app && output && architecture, 'Pass app resources, manifest output, and architecture');
const product = JSON.parse(fs.readFileSync(path.join(app, 'product.json'), 'utf8'));
assert.equal(product.commit, process.env.GITHUB_SHA, 'Packaged commit must match the workflow commit');
assert.equal(product.quality, 'stable', 'Update channel must be included');
assert.equal(product.updateUrl, 'https://api.arnion.ru', 'The product update feed must be included');
const extensions = [];
const skillRoot = path.join(app, 'out', 'vs', 'sessions', 'skills', 'greenscreen-preview');
const skills = ['SKILL.md', 'scripts/greenscreen.py'].map(file => {
	const data = fs.readFileSync(path.join(skillRoot, file));
	return { name: 'greenscreen-preview', version: '1.0.0', file, sha256: crypto.createHash('sha256').update(data).digest('hex') };
});
for (const name of ['copilot', 'arni-agent', 'yandex-authentication', 'vk-authentication']) {
	const folder = path.join(app, 'extensions', name);
	const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
	let main = path.join(folder, manifest.main);
	if (!fs.existsSync(main)) { main += '.js'; }
	const bundle = fs.readFileSync(main, 'utf8');
	if (name === 'copilot') {
		for (const marker of ['balanceMicros', 'arni_managed', 'five_hour_limit', 'weekly_limit', 'arni.showApiUsage', 'arni.getAccountSummary', 'arni_cache', 'X-Arni-Chat-Id']) {
			assert.ok(bundle.includes(marker), 'Missing billing client marker: ' + marker);
		}
	}
	if (name === 'arni-agent') { assert.ok(bundle.includes('balanceMicros'), 'Arni sidebar budget UI is missing'); }
	extensions.push({ name, version: manifest.version, sha256: crypto.createHash('sha256').update(bundle).digest('hex') });
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ commit: product.commit, version: product.version, quality: product.quality, updateUrl: product.updateUrl, architecture, builtAt: new Date().toISOString(), extensions, skills }, null, 2) + '\n');
console.log('Verified packaged billing client, authentication extensions and commit: ' + product.commit);
