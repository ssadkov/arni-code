/* Copyright (c) Microsoft Corporation. Licensed under the MIT License. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ARNI_LIBRARY_AGENTS, ARNI_LIBRARY_SKILLS } from '../src/vs/sessions/contrib/chat/common/arniSkillLibrary.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.argv[2];
if (!destination) { throw new Error('Pass the output JSON path'); }
const skills = ARNI_LIBRARY_SKILLS;
const files = [];
function add(relative) {
	const text = fs.readFileSync(path.join(root, 'src/vs/sessions', relative), 'utf8').replace(/\r\n/g, '\n');
	files.push({ path: relative, text, sha256: crypto.createHash('sha256').update(text).digest('hex') });
}
for (const skill of skills) {
	add(`skills/${skill}/SKILL.md`);
	for (const folder of ['scripts', 'references']) {
		const directory = path.join(root, 'src/vs/sessions/skills', skill, folder);
		if (!fs.existsSync(directory)) { continue; }
		for (const name of fs.readdirSync(directory)) {
			if (/^[a-zA-Z0-9_-]+\.(py|md)$/.test(name)) { add(`skills/${skill}/${folder}/${name}`); }
		}
	}
}
for (const name of ARNI_LIBRARY_AGENTS) { add(`agents/${name}`); }
files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const revision = crypto.createHash('sha256').update(JSON.stringify(files.map(file => [file.path, file.sha256]))).digest('hex');
const library = JSON.stringify({ schemaVersion: 1, revision, files });
if (Buffer.byteLength(library) > 2 * 1024 * 1024) { throw new Error('Library is too large'); }
fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
fs.writeFileSync(destination, library + '\n');
console.log(`Exported ${skills.length} skills, ${ARNI_LIBRARY_AGENTS.length} profession profiles, ${files.length} files; revision ${revision}`);
