/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { decideAgentStatus } from '../../common/agentStatusLine.js';

suite('Agent status line', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('maps file, retry, quota, and raw errors', () => {
		assert.deepStrictEqual(decideAgentStatus('File already exists: arkanoid.html'), { kind: 'replace', text: 'файл уже был, обновляю' });
		assert.deepStrictEqual(decideAgentStatus('Creating file arkanoid.html'), { kind: 'replace', text: 'Пишу arkanoid.html…' });
		assert.deepStrictEqual(decideAgentStatus('Reading file main.ts'), { kind: 'replace', text: 'Читаю файл…' });
		assert.deepStrictEqual(decideAgentStatus('Model stream aborted, retry 1 of 2'), { kind: 'replace', text: 'Модель оборвалась, повторяю 1 из 2…' });
		assert.deepStrictEqual(decideAgentStatus('Nemotron request timed out'), { kind: 'replace', text: 'Nemotron не отвечает, переключить на North Mini?' });
		assert.deepStrictEqual(decideAgentStatus('Free requests remaining: 0'), { kind: 'replace', text: 'Бесплатные запросы на сегодня кончились. Снова в 05:00.' });
		assert.deepStrictEqual(decideAgentStatus('GitHub login required'), { kind: 'hide' });
		assert.deepStrictEqual(decideAgentStatus('Copilot SDK failed to start'), { kind: 'hide' });
		assert.deepStrictEqual(decideAgentStatus('Думаю…'), { kind: 'keep' });
	});
});
