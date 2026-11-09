/* Copyright (c) Microsoft Corporation. Licensed under the MIT License. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [appArgument, executableArgument] = process.argv.slice(2);
assert.ok(appArgument && executableArgument, 'Pass packaged app resources and its Electron executable');
const app = path.resolve(appArgument);
const fixture = path.join(app, 'extensions/copilot/dist', `arni-sdk-smoke-${randomUUID()}.mjs`);
// Resolve from the shipped extension, with its own SDK version and native addon.
fs.writeFileSync(fixture, `
import assert from 'node:assert/strict';
const sdk = await import('@github/copilot/sdk');
assert.equal(typeof sdk.getAvailableModels, 'function');
assert.equal(typeof sdk.resolveAuthInfoFromToken, 'function');
assert.ok(sdk.logger);
console.log('Packaged extension SDK import OK');
process.exit(0);
`, { flag: 'wx' });
try {
	const result = spawnSync(path.resolve(executableArgument), [fixture], {
		env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
		encoding: 'utf8',
		windowsHide: true,
		timeout: 60_000,
	});
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	process.stdout.write(result.stdout);
} finally {
	fs.unlinkSync(fixture);
}
