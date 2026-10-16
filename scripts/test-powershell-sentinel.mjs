/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Runs the actual command wrapper in real Windows PowerShell 5.1; no model/key.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { executeShellCommand } from '../out/vs/platform/agentHost/node/shared/shellCommandExecution.js';

if (process.platform !== 'win32') {
	console.log('Windows PowerShell sentinel integration: Windows only.');
} else {
	const cases = [
		['cmdlet', 'Get-Location', 0],
		['syntax', 'Write-Output before && Write-Output after', 1],
		['throw', "throw 'expected failure'", 1],
		['native failure followed by output', "cmd.exe /d /c exit 7; Write-Output 'after'", 7],
		['native exit retained after cmdlet', '$LASTEXITCODE=7; Get-Location', 7],
		['native success', 'cmd.exe /d /c exit 0', 0],
		['quotes, Unicode, multiline and persistent variables', "$arniSentinelTest='Привет ''Arni''';\nWrite-Output $arniSentinelTest", 0],
	];
	for (const [name, command, expected] of cases) {
		let content = '';
		let listener;
		let writes = 0;
		const manager = {
			supportsCommandDetection: () => false,
			getContent: () => content,
			onData: (_uri, fn) => { listener = fn; return { dispose() {} }; },
			onExit: () => ({ dispose() {} }),
			onClaimChanged: () => ({ dispose() {} }),
			createAltBufferPromise: () => new Promise(() => {}),
			sendText: async (_uri, text) => {
				writes++;
				const encoded = Buffer.from('$LASTEXITCODE=99; ' + text + "; Write-Output ('ARNI_PERSIST=' + $arniSentinelTest)", 'utf16le').toString('base64');
				const child = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8', timeout: 15000 });
				assert.ifError(child.error);
				content += child.stdout;
				queueMicrotask(() => listener?.('data'));
			},
		};
		const result = await executeShellCommand({ terminalUri: 'test:/shell', shellType: 'powershell' }, command, 20000, manager, { info() {}, warn() {} });
		assert.deepEqual({ status: result.status, exit: result.exitCode, writes }, { status: 'completed', exit: expected, writes: 1 }, name);
		if (name.startsWith('quotes')) { assert.ok(content.includes("ARNI_PERSIST=Привет 'Arni'"), 'Dot sourcing must preserve variables'); }
		console.log('PowerShell sentinel passed: ' + name);
	}
}
