/* Copyright (c) Microsoft Corporation. Licensed under the MIT License. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { verifyPackagedCopilotRuntime } from './lib/packaged-copilot-runtime.mjs';

function fixture(architecture, task) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arni-packaged-runtime-'));
	const platform = `darwin-${architecture}`;
	const runtime = path.join(root, 'node_modules.asar.unpacked', '@github', `copilot-${platform}`);
	try {
		for (const file of ['index.js', 'app.js', `prebuilds/${platform}/runtime.node`, `prebuilds/${platform}/cli-native.node`]) {
			const target = path.join(runtime, file);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.writeFileSync(target, 'synthetic-test-content');
		}
		task(root, runtime, platform);
	} finally {
		assert.ok(path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('arni-packaged-runtime-'));
		fs.rmSync(root, { recursive: true, force: true });
	}
}

for (const architecture of ['arm64', 'x64']) {
	test(`validates actual ${architecture} layout without legacy PTY filenames`, () => fixture(architecture, root => {
		const manifest = verifyPackagedCopilotRuntime(root, architecture);
		assert.equal(manifest.length, 4);
		assert.ok(manifest.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
		assert.ok(manifest.some(file => file.file.endsWith('/cli-native.node')));
	}));
}

test('missing or empty required native addon rejects the package', () => fixture('arm64', (root, runtime, platform) => {
	const addon = path.join(runtime, 'prebuilds', platform, 'cli-native.node');
	fs.unlinkSync(addon);
	assert.throws(() => verifyPackagedCopilotRuntime(root, 'arm64'), /cli-native\.node/);
	fs.writeFileSync(addon, '');
	assert.throws(() => verifyPackagedCopilotRuntime(root, 'arm64'), /empty packaged runtime/);
}));
