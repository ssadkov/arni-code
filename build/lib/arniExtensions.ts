/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { stat } from 'fs/promises';
import path from 'path';

const arniExtensionNames = ['arni-agent', 'yandex-authentication', 'vk-authentication'] as const;

/** These extensions use esbuild's dist output, rather than the standard extensions' out directory. */
export async function hasArniExtensionOutputs(repoRoot: string): Promise<boolean> {
	const outputs = await Promise.all(arniExtensionNames.map(async name => {
		try {
			const output = await stat(path.join(repoRoot, 'extensions', name, 'dist', 'extension.js'));
			return output.isFile() && output.size > 0;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return false;
			}
			throw error;
		}
	}));
	return outputs.every(Boolean);
}

export async function buildArniExtensions(repoRoot: string): Promise<void> {
	await Promise.all(arniExtensionNames.map(name => new Promise<void>((resolve, reject) => {
		const child = spawn(process.execPath, ['esbuild.js'], { cwd: path.join(repoRoot, 'extensions', name), stdio: 'inherit' });
		child.on('error', reject);
		child.on('close', code => code === 0 ? resolve() : reject(new Error(`${name} build failed with exit code ${code}`)));
	})));
	if (!await hasArniExtensionOutputs(repoRoot)) {
		throw new Error('Arni extension build did not produce all required dist/extension.js entry points.');
	}
}
