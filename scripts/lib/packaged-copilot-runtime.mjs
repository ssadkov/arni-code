/* Copyright (c) Microsoft Corporation. Licensed under the MIT License. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Verify the startup files shipped by the pinned 1.0.84 macOS runtime. */
export function verifyPackagedCopilotRuntime(app, architecture) {
	assert.ok(['arm64', 'x64'].includes(architecture), 'Unsupported macOS architecture');
	const platform = `darwin-${architecture}`;
	const root = path.join(app, 'node_modules.asar.unpacked', '@github', `copilot-${platform}`);
	// Legacy pty.node/spawn-helper paths are absent from the actual package.
	return ['index.js', 'app.js', `prebuilds/${platform}/runtime.node`, `prebuilds/${platform}/cli-native.node`].map(file => {
		const data = readFileSync(path.join(root, file));
		assert.ok(data.length, 'Missing or empty packaged runtime file: ' + file);
		return { file, sha256: createHash('sha256').update(data).digest('hex') };
	});
}
