/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ARNI_LIBRARY_AGENTS, ARNI_LIBRARY_SKILLS } from '../src/vs/sessions/contrib/chat/common/arniSkillLibrary.ts';
import { verifyPackagedCopilotRuntime } from './lib/packaged-copilot-runtime.mjs';

const [app, output, architecture] = process.argv.slice(2);
assert.ok(app && output && architecture, 'Pass app resources, manifest output, and architecture');
const product = JSON.parse(fs.readFileSync(path.join(app, 'product.json'), 'utf8'));
assert.equal(product.commit, process.env.GITHUB_SHA, 'Packaged commit must match the workflow commit');
assert.equal(product.quality, 'stable', 'Update channel must be included');
assert.equal(product.updateUrl, 'https://api.arnion.ru', 'The product update feed must be included');
const extensions = [];
const skills = [];
const nativeRuntime = process.platform === 'darwin' ? verifyPackagedCopilotRuntime(app, architecture) : [];
for (const name of ARNI_LIBRARY_SKILLS) {
	const source = path.join(import.meta.dirname, '../src/vs/sessions/skills', name);
	const version = fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8').match(/^\s+version:\s*(\S+)/m)?.[1];
	assert.ok(version, 'Missing skill version: ' + name);
	const files = ['SKILL.md'];
	for (const folder of ['scripts', 'references']) {
		if (fs.existsSync(path.join(source, folder))) {
			files.push(...fs.readdirSync(path.join(source, folder)).filter(file => /\.(py|md)$/.test(file)).map(file => folder + '/' + file));
		}
	}
	for (const file of files) {
		const data = fs.readFileSync(path.join(app, 'out/vs/sessions/skills', name, file));
		assert.equal(data.toString('utf8').replace(/\r\n/g, '\n'), fs.readFileSync(path.join(source, file), 'utf8').replace(/\r\n/g, '\n'), 'Wrong packaged skill: ' + name + '/' + file);
		skills.push({ name, version, file, sha256: crypto.createHash('sha256').update(data).digest('hex') });
	}
}
const professions = ARNI_LIBRARY_AGENTS.map(file => {
	const data = fs.readFileSync(path.join(app, 'out/vs/sessions/agents', file));
	assert.equal(data.toString('utf8').replace(/\r\n/g, '\n'), fs.readFileSync(path.join(import.meta.dirname, '../src/vs/sessions/agents', file), 'utf8').replace(/\r\n/g, '\n'));
	return { file, sha256: crypto.createHash('sha256').update(data).digest('hex') };
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
fs.writeFileSync(output, JSON.stringify({ commit: product.commit, version: product.version, quality: product.quality, updateUrl: product.updateUrl, architecture, builtAt: new Date().toISOString(), extensions, skills, professions, nativeRuntime }, null, 2) + '\n');
console.log('Verified packaged billing client, authentication extensions and commit: ' + product.commit);
