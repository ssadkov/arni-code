/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../util/vs/base/common/uuid';
import { IToolCall } from '../../prompt/common/intents';
import { ToolName } from '../../tools/common/toolNames';

/**
 * Last-resort recovery when a BYOK / free model dumps a file (or a fake XML/DSML
 * tool call) into assistant text instead of native OpenAI `tool_calls`. Copilot
 * only executes structured tool calls, so those dumps never hit disk.
 *
 * Follow-ups (not implemented here):
 * 1. Force `tool_choice: required` in agent mode for BYOK so models that actually
 *    support tools cannot finish with `stop`. `LanguageModelChatToolMode.Required`
 *    currently throws if more than one tool is present, so this needs an API-level
 *    path rather than the VS Code toolMode flag.
 * 2. Default the model picker away from free models that do not emit native
 *    tool_calls (Nemotron :free, Qwen3-Coder-Next). Prefer OpenRouter models with
 *    `supported_parameters: tools` that have empirically produced
 *    `finish reason: tool_calls` (DeepSeek V4.1 Flash did once).
 */

const MAX_RECOVERED_CALLS = 5;
const MIN_FILE_CONTENT_LENGTH = 20;

const WRITE_INTENT_RE = /save|create|write|store|\bfile\b|файл|сохрани|создай|запиши|сделай|напиши/i;
const FILENAME_RE = /(?:^|[\s"'`<(])((?:[A-Za-z]:[\\/])?(?:[\w.-]+[\\/])*[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,7})(?=$|[\s"'`>)\]])/g;
const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g;
const TOOL_CALL_BLOCK_RE = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
const INVOKE_BLOCK_RE = /<invoke\b([^>]*)>([\s\S]*?)<\/invoke>/gi;
const HERMES_FUNCTION_RE = /<function=([A-Za-z0-9_.-]+)>([\s\S]*?)<\/function>/gi;
const FILEPATH_COMMENT_RE = /^(?:\/\/|#|<!--)\s*(?:filepath|file(?:path)?|path)\s*[:=]\s*(.+?)(?:\s*-->)?\s*$/i;
const LEADING_NAME_RE = /^\s*([A-Za-z_][\w.-]*)\s*/;
const HTML_DOCUMENT_RE = /<!DOCTYPE\s+html[\s\S]*?<\/html>|<html[\s>][\s\S]*?<\/html>/gi;
/** Tool-call markup that must never end up inside a recovered file. */
const MARKUP_LEAK_RE = /<\/?(?:tool_call|arg_key|arg_value|invoke|parameter)\b/i;

const CREATE_ALIASES = new Set([
	ToolName.CreateFile,
	ToolName.EditFile,
	'write_file',
	'write',
	'save_file',
	'write_to_file',
]);

const REPLACE_ALIASES = new Set([
	ToolName.ReplaceString,
	'str_replace',
	'search_replace',
]);

const PATH_ARG_KEYS = ['filePath', 'file_path', 'path', 'filename', 'file', 'dirPath'] as const;

/** The parameter each tool actually expects its path under, for tools we ship. */
const PATH_ARG_BY_TOOL = new Map<string, string>([
	[ToolName.ReadFile, 'filePath'],
	[ToolName.CreateFile, 'filePath'],
	[ToolName.ReplaceString, 'filePath'],
	[ToolName.MultiReplaceString, 'filePath'],
	[ToolName.EditFile, 'filePath'],
	[ToolName.ListDirectory, 'path'],
]);

/** `read_file` requires a range, and a simulated call never carries one. */
const DEFAULT_READ_FILE_END_LINE = 2000;

export interface IRecoverToolCallsOptions {
	readonly text: string;
	readonly userQuery: string;
	readonly availableToolNames: ReadonlySet<string>;
	/**
	 * Workspace folder paths used to absolutize a bare filename. The edit tools
	 * reject relative paths, and a model that dumps a file into chat almost never
	 * supplies one, so a recovered call without a folder to anchor to is dropped.
	 */
	readonly workspaceFolders?: readonly string[];
}

export function recoverToolCallsFromAssistantText(options: IRecoverToolCallsOptions): IToolCall[] {
	const createAvailable = options.availableToolNames.has(ToolName.CreateFile);
	const replaceAvailable = options.availableToolNames.has(ToolName.ReplaceString);
	if (options.availableToolNames.size === 0) {
		return [];
	}

	const recovered: IToolCall[] = [];
	const seenPaths = new Set<string>();
	const root = normalizeFilePath(options.workspaceFolders?.[0]);

	const pushCreate = (filePath: string, content: string) => {
		if (!createAvailable || recovered.length >= MAX_RECOVERED_CALLS) {
			return;
		}
		const absolute = toAbsolutePath(filePath, root);
		const body = undoDoubleEscaping(content).trimEnd();
		if (!absolute || body.length < MIN_FILE_CONTENT_LENGTH || seenPaths.has(absolute.toLowerCase())) {
			return;
		}
		seenPaths.add(absolute.toLowerCase());
		recovered.push(makeToolCall(ToolName.CreateFile, {
			filePath: absolute,
			content: body,
		}));
	};

	const pushReplace = (filePath: string, oldString: string, newString: string) => {
		if (!replaceAvailable || recovered.length >= MAX_RECOVERED_CALLS) {
			return;
		}
		const absolute = toAbsolutePath(filePath, root);
		if (!absolute || !oldString || newString === undefined || seenPaths.has(`${absolute.toLowerCase()}::replace`)) {
			return;
		}
		seenPaths.add(`${absolute.toLowerCase()}::replace`);
		recovered.push(makeToolCall(ToolName.ReplaceString, {
			explanation: 'Recovered from simulated tool call in assistant text',
			filePath: absolute,
			oldString: undoDoubleEscaping(oldString),
			newString: undoDoubleEscaping(newString),
		}));
	};

	const pushGeneric = (name: string, args: Record<string, unknown>) => {
		if (recovered.length >= MAX_RECOVERED_CALLS) {
			return;
		}
		const normalized = normalizeGenericArgs(name, args, root);
		if (!normalized) {
			return;
		}
		const key = `${name}::${JSON.stringify(normalized)}`;
		if (seenPaths.has(key)) {
			return;
		}
		seenPaths.add(key);
		recovered.push(makeToolCall(name, normalized));
	};

	const fakeCalls = parseFakeToolCalls(options.text);
	for (const fake of fakeCalls) {
		const target = resolveTargetTool(fake.name, options.availableToolNames);
		if (!target) {
			continue;
		}

		if (target === ToolName.CreateFile) {
			const filePath = firstString(fake.args, PATH_ARG_KEYS);
			const content = firstString(fake.args, ['content', 'contents', 'code', 'new_string', 'newString']);
			if (filePath && content) {
				pushCreate(filePath, content);
			}
		} else if (target === ToolName.ReplaceString) {
			const filePath = firstString(fake.args, PATH_ARG_KEYS);
			const oldString = firstString(fake.args, ['oldString', 'old_string', 'old_str', 'replace', 'search', 'old']);
			const newString = firstString(fake.args, ['newString', 'new_string', 'new_str', 'with', 'replacement', 'new']);
			if (filePath && oldString !== undefined && newString !== undefined) {
				pushReplace(filePath, oldString, newString);
			}
		} else {
			pushGeneric(target, fake.args);
		}
	}

	if (createAvailable) {
		for (const fence of parseFencedFiles(options.text, options.userQuery)) {
			pushCreate(fence.filePath, fence.content);
		}

		// A block that names an edit tool is itself proof the model meant to write a
		// file, so the fallback does not need the request to spell that out. That
		// matters for follow-ups such as "try again", which carry no intent of their own.
		const sawEditToolCall = fakeCalls.some(fake => CREATE_ALIASES.has(fake.name) || REPLACE_ALIASES.has(fake.name));
		if (recovered.length === 0 && (sawEditToolCall || hasFileWriteIntent(options.userQuery))) {
			const bare = extractBareHtmlDocument(options.text);
			if (bare) {
				pushCreate(inferHtmlFilename(options.userQuery), bare);
			}
		}
	}

	return recovered;
}

/**
 * A simulated call is only worth replaying when the session actually offers that
 * tool. An exact name wins so a tool keeps its own semantics; the alias sets only
 * cover names a model invents for writing files.
 */
function resolveTargetTool(name: string, available: ReadonlySet<string>): string | undefined {
	if (available.has(name)) {
		return name;
	}
	if (CREATE_ALIASES.has(name) && available.has(ToolName.CreateFile)) {
		return ToolName.CreateFile;
	}
	if (REPLACE_ALIASES.has(name) && available.has(ToolName.ReplaceString)) {
		return ToolName.ReplaceString;
	}
	return undefined;
}

function normalizeGenericArgs(name: string, args: Record<string, unknown>, root: string | undefined): Record<string, unknown> | undefined {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(args)) {
		out[key] = typeof value === 'string' ? undoDoubleEscaping(value) : value;
	}

	const presentKey = PATH_ARG_KEYS.find(key => typeof out[key] === 'string');
	if (presentKey) {
		const absolute = toAbsolutePath(out[presentKey] as string, root);
		if (!absolute) {
			return undefined;
		}
		const canonicalKey = PATH_ARG_BY_TOOL.get(name) ?? presentKey;
		if (canonicalKey !== presentKey) {
			delete out[presentKey];
		}
		out[canonicalKey] = absolute;
	}

	if (name === ToolName.ReadFile) {
		out.startLine ??= 1;
		out.endLine ??= DEFAULT_READ_FILE_END_LINE;
	}

	return out;
}

function makeToolCall(name: string, args: Record<string, unknown>): IToolCall {
	return {
		name,
		arguments: JSON.stringify(args),
		id: `recovered-${generateUuid()}`,
	};
}

function hasFileWriteIntent(query: string): boolean {
	return WRITE_INTENT_RE.test(query) || extractFilenames(query).length > 0;
}

function parseFakeToolCalls(text: string): { name: string; args: Record<string, unknown> }[] {
	const results: { name: string; args: Record<string, unknown> }[] = [];

	for (const match of text.matchAll(TOOL_CALL_BLOCK_RE)) {
		const parsed = parseToolCallPayload(match[1]);
		if (parsed) {
			results.push(parsed);
		}
	}

	for (const match of text.matchAll(INVOKE_BLOCK_RE)) {
		const name = /(?:name|tool)\s*=\s*["']?([A-Za-z0-9_.-]+)/i.exec(match[1])?.[1];
		const parsed = parseToolCallPayload(match[2], name);
		if (parsed) {
			results.push(parsed);
		}
	}

	for (const match of text.matchAll(HERMES_FUNCTION_RE)) {
		const parsed = parseToolCallPayload(match[2], match[1]);
		if (parsed) {
			results.push(parsed);
		}
	}

	return results;
}

function parseToolCallPayload(payload: string, fallbackName?: string): { name: string; args: Record<string, unknown> } | undefined {
	const trimmed = payload.trim();
	if (!trimmed) {
		return undefined;
	}

	const jsonCandidate = extractJsonObject(trimmed);
	if (jsonCandidate) {
		const asCall = asNamedArguments(jsonCandidate, fallbackName);
		if (asCall) {
			return asCall;
		}
	}

	// Any identifier is accepted here; resolveTargetTool decides whether the
	// session actually offers a tool by that name.
	const name = fallbackName ?? LEADING_NAME_RE.exec(trimmed)?.[1];
	if (!name) {
		return undefined;
	}

	const body = fallbackName ? trimmed : trimmed.slice(LEADING_NAME_RE.exec(trimmed)![0].length);
	for (const parse of [parseXmlArguments, parseArgKeyArguments, parseCallSyntaxArguments]) {
		const args = parse(body);
		if (Object.keys(args).length > 0) {
			return { name, args };
		}
	}

	return { name, args: {} };
}

function asNamedArguments(value: Record<string, unknown>, fallbackName?: string): { name: string; args: Record<string, unknown> } | undefined {
	const name = (typeof value.name === 'string' && value.name)
		|| (typeof value.tool === 'string' && value.tool)
		|| fallbackName;
	if (!name) {
		return undefined;
	}

	const rawArgs = value.arguments ?? value.args ?? value.parameters ?? value;
	let args: Record<string, unknown>;
	if (typeof rawArgs === 'string') {
		try {
			const parsed = JSON.parse(rawArgs);
			args = isPlainObject(parsed) ? parsed : {};
		} catch {
			args = {};
		}
	} else if (isPlainObject(rawArgs)) {
		args = rawArgs === value
			? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'name' && key !== 'tool'))
			: rawArgs;
	} else {
		args = {};
	}

	return { name, args };
}

function parseXmlArguments(payload: string): Record<string, unknown> {
	const args: Record<string, unknown> = {};
	const parameterRe = /<(?:parameter|arg|param)\s+name=["']([^"']+)["']>([\s\S]*?)<\/(?:parameter|arg|param)>/gi;
	for (const match of payload.matchAll(parameterRe)) {
		args[match[1]] = decodeXml(match[2].trim());
	}
	return args;
}

/**
 * `<arg_key>path</arg_key>value<arg_key>content</arg_key>value</arg_value>` — GLM
 * emits the keys as tags but often omits the matching `<arg_value>` opener, so a
 * value runs until the next key.
 */
function parseArgKeyArguments(payload: string): Record<string, unknown> {
	const keys: { key: string; valueStart: number }[] = [];
	for (const match of payload.matchAll(/<arg_key>([\s\S]*?)<\/arg_key>\s*(?:<arg_value>)?/gi)) {
		keys.push({ key: match[1].trim(), valueStart: match.index + match[0].length });
	}

	const args: Record<string, unknown> = {};
	for (const [i, { key, valueStart }] of keys.entries()) {
		const next = keys[i + 1];
		const end = next
			? payload.lastIndexOf('<arg_key>', next.valueStart)
			: payload.length;
		const value = payload.slice(valueStart, end < valueStart ? payload.length : end)
			.replace(/<\/arg_value>\s*$/i, '')
			.replace(/^\r?\n/, '');
		args[key] = decodeXml(value.trim().length === value.length ? value : value.trim());
	}
	return args;
}

/**
 * `create_file(path="...", content="...")` — the inner quotes of the payload are
 * usually left unescaped, so each value runs up to the next `key="` instead of the
 * next quote.
 */
function parseCallSyntaxArguments(payload: string): Record<string, unknown> {
	const body = payload.trimStart();
	if (!body.startsWith('(')) {
		return {};
	}
	const rest = body.slice(1).replace(/\)\s*$/, '');

	const keys: { key: string; keyStart: number; valueStart: number }[] = [];
	for (const match of rest.matchAll(/(?:^|,)\s*([A-Za-z_]\w*)\s*=\s*"/g)) {
		keys.push({ key: match[1], keyStart: match.index, valueStart: match.index + match[0].length });
	}

	const args: Record<string, unknown> = {};
	for (const [i, { key, valueStart }] of keys.entries()) {
		const next = keys[i + 1];
		const slice = rest.slice(valueStart, next ? next.keyStart : rest.length);
		let value = slice.replace(/[\s,]*$/, '');
		if (value.endsWith('"')) {
			value = value.slice(0, -1);
		}
		args[key] = value;
	}
	return args;
}

function parseFencedFiles(text: string, userQuery: string): { filePath: string; content: string }[] {
	const writeIntent = hasFileWriteIntent(userQuery);
	const queryFiles = extractFilenames(userQuery);
	const results: { filePath: string; content: string }[] = [];

	for (const match of text.matchAll(FENCE_RE)) {
		const info = match[1].trim();
		let content = stripFenceContent(match[2]);
		if (content.length < MIN_FILE_CONTENT_LENGTH) {
			continue;
		}

		const fromComment = takeFilepathComment(content);
		if (fromComment) {
			content = fromComment.content;
		}

		const filePath = filenameFromFenceInfo(info)
			?? fromComment?.filePath
			?? inferFilenameFromQuery(queryFiles, info, content, userQuery, writeIntent);

		if (filePath) {
			results.push({ filePath, content });
		}
	}

	return results;
}

function filenameFromFenceInfo(info: string): string | undefined {
	if (!info) {
		return undefined;
	}
	const tokens = info.split(/[\s=:]+/).map(token => token.replace(/^["'`]+|["'`]+$/g, '')).filter(Boolean);
	for (let i = tokens.length - 1; i >= 0; i--) {
		const normalized = normalizeFilePath(tokens[i]);
		if (normalized && looksLikeFilename(normalized)) {
			return normalized;
		}
	}
	return undefined;
}

function inferFilenameFromQuery(queryFiles: string[], fenceInfo: string, content: string, userQuery: string, writeIntent: boolean): string | undefined {
	if (queryFiles.length === 1) {
		return queryFiles[0];
	}

	const language = fenceInfo.split(/[\s=:]+/)[0]?.toLowerCase();
	const ext = extensionForLanguage(language) ?? (looksLikeHtml(content) ? 'html' : undefined);
	if (queryFiles.length > 1 && ext) {
		const match = queryFiles.find(file => file.toLowerCase().endsWith(`.${ext}`));
		if (match) {
			return match;
		}
	}

	if (!writeIntent) {
		return undefined;
	}

	if (ext === 'html' || looksLikeHtml(content)) {
		return inferHtmlFilename(userQuery);
	}

	if (ext) {
		return `index.${ext}`;
	}

	return undefined;
}

function inferHtmlFilename(query: string): string {
	const named = extractFilenames(query).find(file => file.toLowerCase().endsWith('.html') || file.toLowerCase().endsWith('.htm'));
	if (named) {
		return named;
	}
	if (/calc|калькул/i.test(query)) {
		return 'calculator.html';
	}
	return 'index.html';
}

/**
 * Returns the last complete document in the text. Each match stops at its own
 * closing tag, so a response holding both a before and an after copy yields the
 * new one rather than one blob spanning the markup between them.
 */
function extractBareHtmlDocument(text: string): string | undefined {
	let last: string | undefined;
	for (const match of text.matchAll(HTML_DOCUMENT_RE)) {
		const candidate = match[0].trim();
		if (candidate.length >= MIN_FILE_CONTENT_LENGTH && !MARKUP_LEAK_RE.test(candidate)) {
			last = candidate;
		}
	}
	return last;
}

function extractFilenames(text: string): string[] {
	const names: string[] = [];
	for (const match of text.matchAll(FILENAME_RE)) {
		const normalized = normalizeFilePath(match[1]);
		if (normalized && looksLikeFilename(normalized)) {
			names.push(normalized);
		}
	}
	return names;
}

function stripFenceContent(content: string): string {
	return content.replace(/^\n+/, '').replace(/\n+$/, '');
}

function takeFilepathComment(content: string): { filePath: string; content: string } | undefined {
	const firstLineEnd = content.indexOf('\n');
	const firstLine = (firstLineEnd === -1 ? content : content.slice(0, firstLineEnd)).trim();
	const match = FILEPATH_COMMENT_RE.exec(firstLine);
	if (!match) {
		return undefined;
	}
	const filePath = normalizeFilePath(match[1].trim());
	if (!filePath) {
		return undefined;
	}
	const rest = firstLineEnd === -1 ? '' : content.slice(firstLineEnd + 1);
	return { filePath, content: rest.replace(/^\n/, '') };
}

function looksLikeHtml(content: string): boolean {
	return /<!DOCTYPE\s+html/i.test(content) || /<html[\s>]/i.test(content);
}

function looksLikeFilename(value: string): boolean {
	return /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(value) && !value.includes('://');
}

/**
 * Some models escape their JSON payload twice, so a parsed `content` still holds
 * the literal characters `\n` and `\"` instead of newlines and quotes. Only undo
 * that when the string has no real line break at all, so genuinely escaped source
 * code (a regex, a string literal) is left untouched.
 */
function undoDoubleEscaping(value: string): string {
	if (value.includes('\n') || !/\\[nrt"']/.test(value)) {
		return value;
	}
	return value.replace(/\\(.)/g, (match, char: string) => {
		switch (char) {
			case 'n': return '\n';
			case 'r': return '\r';
			case 't': return '\t';
			case '"': return '"';
			case "'": return "'";
			case '\\': return '\\';
			default: return match;
		}
	});
}

function isAbsolutePath(value: string): boolean {
	return value.startsWith('/') || /^[A-Za-z]:\//.test(value);
}

function toAbsolutePath(value: string | undefined, root: string | undefined): string | undefined {
	const normalized = normalizeFilePath(value);
	if (!normalized) {
		return undefined;
	}
	if (isAbsolutePath(normalized)) {
		return normalized;
	}
	if (!root || !isAbsolutePath(root)) {
		return undefined;
	}
	return `${root.replace(/\/+$/, '')}/${normalized.replace(/^\.\//, '')}`;
}

function normalizeFilePath(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	const trimmed = value.trim().replace(/^["'`]+|["'`]+$/g, '');
	if (!trimmed || trimmed.includes('..') || /^(https?:|file:)/i.test(trimmed)) {
		return undefined;
	}
	return trimmed.replace(/\\/g, '/');
}

function extensionForLanguage(language: string | undefined): string | undefined {
	switch (language) {
		case 'html':
		case 'htm':
			return 'html';
		case 'javascript':
		case 'js':
			return 'js';
		case 'typescript':
		case 'ts':
			return 'ts';
		case 'css':
			return 'css';
		case 'json':
			return 'json';
		case 'python':
		case 'py':
			return 'py';
		case 'markdown':
		case 'md':
			return 'md';
		default:
			return undefined;
	}
}

function extractJsonObject(text: string): Record<string, unknown> | undefined {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(text.slice(start, end + 1));
		return isPlainObject(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function firstString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = args[key];
		if (typeof value === 'string' && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

function decodeXml(value: string): string {
	return value
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
