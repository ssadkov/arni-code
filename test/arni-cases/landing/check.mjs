/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Verify the agent's landing page: facts from the brief and arnion.kz, offline single file,
// mobile/desktop layout in real Chromium, and the screenshots the agent was asked to review.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const project = path.resolve(process.argv[2] ?? 'C:/work/test-arni-landing');
const results = [];
const check = (name, ok, detail = '') => results.push({ check: name, ok: Boolean(ok), ...(ok || !detail ? {} : { detail: String(detail).slice(0, 200) }) });

const MODULES = [
	'Что такое AI-агент и где он экономит время',
	'Документы: договоры, счета и акты по реквизитам',
	'Сайты и формы: лендинг за вечер',
	'Свой агент для отдела: навыки, проверки, бюджет',
];

function pngWidth(file) {
	const bytes = fs.readFileSync(file);
	return bytes.toString('ascii', 12, 16) === 'IHDR' ? bytes.readUInt32BE(16) : 0;
}

const manifest = JSON.parse(fs.readFileSync(path.join(project, '.case.json'), 'utf8'));
const brief = fs.readFileSync(path.join(project, manifest.brief));
check('бриф не изменён', crypto.createHash('sha256').update(brief).digest('hex') === manifest.sha256);

const page = path.join(project, 'output', 'index.html');
if (!fs.existsSync(page)) {
	check('output/index.html создан', false);
	finish();
}
const html = fs.readFileSync(page, 'utf8');
check('нет внешних скриптов и стилей', !/<script[^>]+src=["']?https?:|<link[^>]+href=["']?https?:/i.test(html), html.match(/(src|href)=["']?https?:[^"' >]+/i)?.[0]);
check('нет заглушек', !/lorem ipsum|TODO|placeholder text/i.test(html));
check('meta viewport', /<meta[^>]+name=["']viewport["']/i.test(html));

const browser = await chromium.launch();
try {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const desktop = await context.newPage();
	await desktop.goto(pathToFileURL(page).href);
	const text = (await desktop.locator('body').innerText()).replace(/\s+/g, ' ');
	const h1 = (await desktop.locator('h1').allInnerTexts()).join(' ');
	check('h1 — название курса', h1.includes('AI-агенты для бизнеса'), h1);
	MODULES.forEach((title, index) => check(`модуль ${index + 1} дословно`, text.includes(title), title));
	check('дата старта', /02\.11\.2026|2 ноября 2026/.test(text));
	check('стоимость', /450[\s\u00a0\u202f]?000/.test(text) && /тенге|₸/.test(text));
	check('расписание', text.includes('19:00'));
	check('e-mail с сайта', text.includes('zakaz@arnion.kz'));
	check('телефон с сайта', text.replace(/\D/g, '').includes('77057252942'));
	check('БИН и юрлицо', text.includes('221040013762') && /Эдбиз/.test(text));
	check('кнопка записи — mailto', await desktop.locator('a[href^="mailto:zakaz@arnion.kz"]').count() > 0);
	check('FAQ: три вопроса', ['программировать', 'Что нужно для участия', 'записи'].every(part => text.includes(part)));
	const altMissing = await desktop.locator('img:not([alt])').count();
	check('у всех изображений есть alt', altMissing === 0, `${altMissing} без alt`);
	const ctaDesktop = await desktop.locator('a[href^="mailto:"]').first().boundingBox();
	check('десктоп: кнопка записи на первом экране', ctaDesktop && ctaDesktop.y + ctaDesktop.height <= 900, JSON.stringify(ctaDesktop));

	const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
	const mobile = await mobileContext.newPage();
	await mobile.goto(pathToFileURL(page).href);
	// Mobile emulation widens innerWidth to fit overflowing content, so compare with the device width.
	const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - 375);
	check('мобильный: нет горизонтальной прокрутки', overflow <= 0, `лишние ${overflow}px`);
	const smallText = await mobile.evaluate(() => [...document.querySelectorAll('p, li')].filter(el => el.innerText.trim() && parseFloat(getComputedStyle(el).fontSize) < 14).length);
	check('мобильный: основной текст не меньше 14px', smallText === 0, `${smallText} блоков`);
	const ctaMobile = await mobile.locator('a[href^="mailto:"]').first().boundingBox();
	check('мобильный: кнопка записи на первом экране', ctaMobile && ctaMobile.y + ctaMobile.height <= 812, JSON.stringify(ctaMobile));
} finally {
	await browser.close();
}

for (const [name, width] of [['desktop.png', 1440], ['mobile.png', 375]]) {
	const file = path.join(project, 'output', name);
	const actual = fs.existsSync(file) ? pngWidth(file) : 0;
	// Device pixel ratio 1–3 is acceptable for a full-page screenshot.
	check(`скриншот ${name}`, [1, 2, 3].some(ratio => actual === width * ratio), actual ? `ширина ${actual}` : 'нет файла');
}
finish();

function finish() {
	const failed = results.filter(result => !result.ok);
	console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, failed }, null, '\t'));
	process.exit(failed.length ? 1 : 0);
}
