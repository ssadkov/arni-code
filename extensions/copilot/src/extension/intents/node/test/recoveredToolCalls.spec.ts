/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { ToolName } from '../../../tools/common/toolNames';
import { recoverToolCallsFromAssistantText } from '../recoveredToolCalls';

const available = new Set<string>([ToolName.CreateFile, ToolName.ReplaceString]);
const workspaceFolders = ['/work/calc'];

function parseArgs(call: { arguments: string }): Record<string, string> {
	return JSON.parse(call.arguments);
}

describe('recoverToolCallsFromAssistantText', () => {
	test('recovers a fenced HTML file named in the fence info', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: [
				'Here is the calculator:',
				'```html calculator.html',
				'<!DOCTYPE html>',
				'<html><body><h1>Calc</h1></body></html>',
				'```',
			].join('\n'),
			userQuery: 'create a calculator and save it',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].name).toBe(ToolName.CreateFile);
		expect(parseArgs(calls[0])).toEqual({
			filePath: '/work/calc/calculator.html',
			content: '<!DOCTYPE html>\n<html><body><h1>Calc</h1></body></html>',
		});
	});

	test('recovers a fenced file from a Russian save request without an explicit filename', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: [
				'Готово:',
				'```html',
				'<!DOCTYPE html>',
				'<html lang="ru"><body>калькулятор</body></html>',
				'```',
			].join('\n'),
			userQuery: 'калькулятор html js сохрани в файл',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		expect(parseArgs(calls[0]).filePath).toBe('/work/calc/calculator.html');
	});

	test('drops a relative recovered path when no workspace folder is open', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: '```html calculator.html\n<!DOCTYPE html>\n<html><body>hi</body></html>\n```',
			userQuery: 'save calculator.html',
			availableToolNames: available,
			workspaceFolders: [],
		});

		expect(calls).toHaveLength(0);
	});

	test('keeps an absolute path the model already supplied', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: `<tool_call>
{"name": "create_file", "arguments": {"filePath": "C:\\\\work\\\\other\\\\app.js", "content": "console.log('hi');\\nconsole.log('there');"}}
</tool_call>`,
			userQuery: 'anything',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		expect(parseArgs(calls[0]).filePath).toBe('C:/work/other/app.js');
	});

	test('undoes double-escaped content emitted by Qwen-style dumps', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: `<tool_call>
{"name":"create_file","arguments":{"filePath":"calculator.html","content":"<!DOCTYPE html>\\\\n<html lang=\\\\\\"ru\\\\\\">\\\\n<body>ок</body>\\\\n</html>"}}
</tool_call>`,
			userQuery: 'создай calculator.html',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		expect(parseArgs(calls[0]).content).toBe('<!DOCTYPE html>\n<html lang="ru">\n<body>ок</body>\n</html>');
	});

	test('keeps genuinely escaped sequences in multi-line source', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: [
				'```js app.js',
				'const re = /\\d+/g;',
				'const s = "a\\nb";',
				'```',
			].join('\n'),
			userQuery: 'save app.js',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		expect(parseArgs(calls[0]).content).toBe('const re = /\\d+/g;\nconst s = "a\\nb";');
	});

	test('recovers GLM call syntax whose inner quotes are unescaped', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: '<tool_call>create_file(path="c:\\work\\calc\\calculator.html", content="<!DOCTYPE html>\n<html lang="ru"><body>ок</body></html>")</tool_call>',
			userQuery: 'создай калькулятор',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		expect(parseArgs(calls[0]).filePath).toBe('c:/work/calc/calculator.html');
		expect(parseArgs(calls[0]).content).toBe('<!DOCTYPE html>\n<html lang="ru"><body>ок</body></html>');
	});

	test('recovers GLM arg_key syntax that omits the arg_value opener', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: '<tool_call>create_file<arg_key>path</arg_key>c:\\work\\calc\\calculator.html<arg_key>content</arg_key>\n<!DOCTYPE html>\n<html><body>ок</body></html>\n</arg_value></tool_call>',
			userQuery: 'Try Again',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		expect(parseArgs(calls[0]).filePath).toBe('c:/work/calc/calculator.html');
		expect(parseArgs(calls[0]).content).toBe('<!DOCTYPE html>\n<html><body>ок</body></html>');
	});

	test('falls back to the dumped document when a follow-up carries no write intent', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: '<tool_call>create_file<arg_key>weird</arg_key>\n<!DOCTYPE html>\n<html><body>калькулятор</body></html>\n</tool_call>',
			userQuery: 'Try Again',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		expect(parseArgs(calls[0]).filePath).toBe('/work/calc/index.html');
	});

	test('ignores a tool call block the model never finished', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: '<tool_call>create_file(path="calculator.html", content="<!DOCTYPE html>\n<html><body><button onclick="x()">',
			userQuery: 'создай calculator.html',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(0);
	});

	test('does not recover a code example when the user did not ask to save a file', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: [
				'HTML looks like this:',
				'```html',
				'<!DOCTYPE html>',
				'<html><body>hello</body></html>',
				'```',
			].join('\n'),
			userQuery: 'what does a basic HTML page look like?',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(0);
	});

	test('recovers Qwen-style <tool_call> JSON', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: `<tool_call>
{"name": "create_file", "arguments": {"filePath": "app.js", "content": "console.log('hi');\\nconsole.log('there');"}}
</tool_call>`,
			userQuery: 'anything',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		expect(parseArgs(calls[0])).toEqual({
			filePath: '/work/calc/app.js',
			content: "console.log('hi');\nconsole.log('there');",
		});
	});

	test('maps insert_edit_into_file dumps onto create_file', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: `<invoke name="insert_edit_into_file">
<parameter name="filePath">notes.txt</parameter>
<parameter name="code">hello from a fake edit tool
second line</parameter>
</invoke>`,
			userQuery: 'write notes',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].name).toBe(ToolName.CreateFile);
		expect(parseArgs(calls[0]).filePath).toBe('/work/calc/notes.txt');
		expect(parseArgs(calls[0]).content).toContain('hello from a fake edit tool');
	});

	test('recovers a bare HTML document dumped without fences', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: 'Sure.\n<!DOCTYPE html>\n<html><head><title>Calc</title></head><body></body></html>\n',
			userQuery: 'создай calculator.html',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		expect(parseArgs(calls[0]).filePath).toBe('/work/calc/calculator.html');
		expect(parseArgs(calls[0]).content).toContain('<!DOCTYPE html>');
	});

	test('recovers replace_string_in_file from a JSON tool_call block', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: `<tool_call>
{"name":"replace_string_in_file","arguments":{"filePath":"a.ts","oldString":"foo","newString":"bar"}}
</tool_call>`,
			userQuery: 'rename foo',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].name).toBe(ToolName.ReplaceString);
		expect(parseArgs(calls[0])).toMatchObject({
			filePath: '/work/calc/a.ts',
			oldString: 'foo',
			newString: 'bar',
		});
	});

	test('recovers a replace call that names its arguments replace/with', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: '<tool_call>replace_string_in_file<arg_key>filePath</arg_key><arg_value>c:/work/calc/calculator.html</arg_value><arg_key>replace</arg_key><arg_value>background: #1a1a2e;</arg_value><arg_key>with</arg_key><arg_value>background: #0b1622;</arg_value></tool_call>',
			userQuery: 'поменяй цвет фона',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].name).toBe(ToolName.ReplaceString);
		expect(JSON.parse(calls[0].arguments)).toMatchObject({
			filePath: 'c:/work/calc/calculator.html',
			oldString: 'background: #1a1a2e;',
			newString: 'background: #0b1622;',
		});
	});

	test('never merges a before and after copy into one recovered file', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: '<tool_call>rewrite<arg_key>old</arg_key><arg_value><!DOCTYPE html>\n<html><body>старый</body></html></arg_value><arg_key>new</arg_key><arg_value><!DOCTYPE html>\n<html><body>новый калькулятор</body></html></arg_value></tool_call>',
			userQuery: 'сохрани в файл',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		const content = parseArgs(calls[0]).content;
		expect(content).toBe('<!DOCTYPE html>\n<html><body>новый калькулятор</body></html>');
		expect(content).not.toContain('arg_key');
	});

	test('recovers a simulated read_file and supplies the range it requires', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: '<tool_call>read_file<arg_key>filePath</arg_key>\n<arg_value>c:\\work\\calc\\calculator.html</arg_value></tool_call>',
			userQuery: 'поменяй цвета',
			availableToolNames: new Set([...available, ToolName.ReadFile]),
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].name).toBe(ToolName.ReadFile);
		expect(JSON.parse(calls[0].arguments)).toEqual({
			filePath: 'c:/work/calc/calculator.html',
			startLine: 1,
			endLine: 2000,
		});
	});

	test('keeps the path parameter name a tool actually declares', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: '<tool_call>list_dir<arg_key>path</arg_key>\n<arg_value>src</arg_value></tool_call>',
			userQuery: 'что в папке',
			availableToolNames: new Set([...available, ToolName.ListDirectory]),
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		expect(JSON.parse(calls[0].arguments)).toEqual({ path: '/work/calc/src' });
	});

	test('ignores a simulated call for a tool the session does not offer', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: '<tool_call>run_in_terminal<arg_key>command</arg_key>\n<arg_value>rm -rf /</arg_value></tool_call>',
			userQuery: 'почисти',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(0);
	});

	test('does nothing when create_file is not available', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: '```html calculator.html\n<!DOCTYPE html><html></html>\n```',
			userQuery: 'save calculator.html',
			availableToolNames: new Set(),
			workspaceFolders,
		});

		expect(calls).toHaveLength(0);
	});

	test('reads a filepath comment inside the fence', () => {
		const calls = recoverToolCallsFromAssistantText({
			text: [
				'```ts',
				'// filepath: src/hello.ts',
				'export const hello = "world";',
				'export const again = true;',
				'```',
			].join('\n'),
			userQuery: 'create the file',
			availableToolNames: available,
			workspaceFolders,
		});

		expect(calls).toHaveLength(1);
		expect(parseArgs(calls[0]).filePath).toBe('/work/calc/src/hello.ts');
	});
});
