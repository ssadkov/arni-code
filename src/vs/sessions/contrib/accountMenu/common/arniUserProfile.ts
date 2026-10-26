/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

export const arniProfileFields = [
	{ key: 'firstName', label: localize('arni.profile.firstName', 'Имя'), section: 'person' },
	{ key: 'lastName', label: localize('arni.profile.lastName', 'Фамилия'), section: 'person' },
	{ key: 'firstNameLatin', label: localize('arni.profile.firstNameLatin', 'Имя латиницей'), section: 'person' },
	{ key: 'lastNameLatin', label: localize('arni.profile.lastNameLatin', 'Фамилия латиницей'), section: 'person' },
	{ key: 'email', label: localize('arni.profile.email', 'Email для анкет'), section: 'contacts' },
	{ key: 'phone', label: localize('arni.profile.phone', 'Телефон'), section: 'contacts' },
	{ key: 'country', label: localize('arni.profile.country', 'Страна'), section: 'contacts' },
	{ key: 'city', label: localize('arni.profile.city', 'Город'), section: 'contacts' },
	{ key: 'companyName', label: localize('arni.profile.companyName', 'Название организации'), section: 'company' },
	{ key: 'companyBin', label: localize('arni.profile.companyBin', 'БИН организации'), section: 'company' },
	{ key: 'jobTitle', label: localize('arni.profile.jobTitle', 'Должность'), section: 'company' },
	{ key: 'website', label: localize('arni.profile.website', 'Сайт'), section: 'company' },
	{ key: 'bio', label: localize('arni.profile.bio', 'Краткая биография'), section: 'company' },
] as const;

export type ArniProfileField = typeof arniProfileFields[number]['key'];
export type ArniProfileValues = Partial<Record<ArniProfileField, string>>;
export const arniCustomProfileFieldLimit = 50;
export interface IArniCustomProfileField {
	readonly id: string;
	readonly label: string;
	readonly value: string;
}
export interface IArniUserProfile {
	readonly schemaVersion: 2;
	readonly values: ArniProfileValues;
	readonly customFields: readonly IArniCustomProfileField[];
}

export interface IArniProfileUpdate {
	readonly field: string;
	readonly label?: string;
	readonly value: string | null;
}

export function validateArniCustomFields(fields: readonly IArniCustomProfileField[]): IArniCustomProfileField[] {
	if (!Array.isArray(fields) || fields.length > arniCustomProfileFieldLimit) { throw new Error(localize('arni.profile.customLimit', 'Можно сохранить до {0} своих полей.', arniCustomProfileFieldLimit)); }
	const ids = new Set<string>();
	const labels = new Set<string>(arniProfileFields.flatMap(field => [field.key.toLowerCase(), field.label.toLowerCase()]));
	return fields.map(field => {
		if (!field || typeof field.id !== 'string' || !/^custom_[a-z0-9][a-z0-9_-]{0,63}$/.test(field.id) || ids.has(field.id)
			|| typeof field.label !== 'string' || !field.label.trim() || field.label.length > 80 || /[\u0000-\u001f\u007f]/.test(field.label)
			|| labels.has(field.label.trim().toLowerCase()) || typeof field.value !== 'string' || field.value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(field.value)) {
			throw new Error(localize('arni.profile.invalidCustom', 'Проверьте свои поля: названия должны быть уникальными, до 80 символов, значения — до 2000 символов.'));
		}
		ids.add(field.id);
		labels.add(field.label.trim().toLowerCase());
		return { id: field.id, label: field.label.trim(), value: field.value.trim() };
	}).sort((a, b) => a.id.localeCompare(b.id));
}

export function arniProfileEntries(profile: IArniUserProfile): IArniCustomProfileField[] {
	return [...arniProfileFields.map(field => ({ id: field.key, label: field.label, value: profile.values[field.key] ?? '' })), ...profile.customFields];
}

/** Apply a partial update without replacing fields the model did not request. */
export function applyArniProfileUpdates(profile: IArniUserProfile, updates: readonly IArniProfileUpdate[]): IArniUserProfile {
	if (!Array.isArray(updates) || !updates.length || updates.length > arniProfileFields.length + arniCustomProfileFieldLimit) { throw new Error('Invalid profile updates'); }
	const values = { ...profile.values };
	const custom = new Map(profile.customFields.map(field => [field.id, field]));
	const seen = new Set<string>();
	for (const update of updates) {
		if (!update || typeof update.field !== 'string' || seen.has(update.field) || (update.value !== null && typeof update.value !== 'string')) { throw new Error('Invalid or duplicate profile update'); }
		seen.add(update.field);
		const builtin = arniProfileFields.find(field => field.key === update.field);
		if (builtin) {
			if (update.label !== undefined) { throw new Error('Built-in labels cannot be changed'); }
			if (update.value === null) { delete values[builtin.key]; } else { values[builtin.key] = update.value; }
		} else {
			if (!/^custom_[a-z0-9][a-z0-9_-]{0,63}$/.test(update.field)) { throw new Error('Use a custom_ field ID'); }
			if (update.value === null) { custom.delete(update.field); } else {
				custom.set(update.field, { id: update.field, label: update.label ?? custom.get(update.field)?.label ?? '', value: update.value });
			}
		}
	}
	return { schemaVersion: 2, values: validateArniProfile(values), customFields: validateArniCustomFields([...custom.values()]) };
}

/** Only these explicit, bounded fields can enter the personal card. IDs stay strings. */
export function validateArniProfile(values: ArniProfileValues): ArniProfileValues {
	if (!values || typeof values !== 'object' || Array.isArray(values)) {
		throw new Error(localize('arni.profile.invalid', 'Некорректный формат карточки.'));
	}
	const result: ArniProfileValues = {};
	for (const key of Object.keys(values)) {
		const field = arniProfileFields.find(field => field.key === key);
		if (!field) {
			throw new Error(localize('arni.profile.unknownField', 'Неизвестное поле карточки.'));
		}
		const value = values[field.key];
		if (typeof value !== 'string' || value.length > (field.key === 'bio' ? 2000 : 250) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
			throw new Error(localize('arni.profile.invalidField', 'Проверьте поле «{0}»: слишком длинный или некорректный текст.', field.label));
		}
		if (value.trim()) {
			result[field.key] = value.trim();
		}
	}
	if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) {
		throw new Error(localize('arni.profile.invalidEmail', 'Проверьте email для анкет.'));
	}
	if (result.companyBin && !/^\d{12}$/.test(result.companyBin)) {
		throw new Error(localize('arni.profile.invalidBin', 'БИН должен содержать 12 цифр. Если он не нужен, оставьте поле пустым.'));
	}
	return result;
}

export function parseArniProfile(text: string | undefined): IArniUserProfile {
	if (!text) {
		return { schemaVersion: 2, values: {}, customFields: [] };
	}
	if (text.length > 128000) {
		throw new Error(localize('arni.profile.tooLarge', 'Карточка превышает допустимый размер.'));
	}
	const data: { schemaVersion: number; values: ArniProfileValues; customFields?: readonly IArniCustomProfileField[] } = JSON.parse(text);
	if (data?.schemaVersion !== 1 && data?.schemaVersion !== 2) {
		throw new Error(localize('arni.profile.version', 'Версия карточки не поддерживается.'));
	}
	return { schemaVersion: 2, values: validateArniProfile(data.values), customFields: data.schemaVersion === 1 ? [] : validateArniCustomFields(data.customFields ?? []) };
}

/** Field IDs or unique visible labels can be requested; omitted selection means the whole card. */
export function selectArniProfileEntries(profile: IArniUserProfile, fields?: readonly string[]): { entries: IArniCustomProfileField[]; missingFields: string[] } {
	const all = arniProfileEntries(profile);
	if (fields === undefined) { return { entries: all, missingFields: all.filter(field => !field.value).map(field => field.id) }; }
	if (!Array.isArray(fields) || !fields.length || fields.length > arniProfileFields.length + arniCustomProfileFieldLimit || fields.some(field => typeof field !== 'string' || !field.trim() || field.length > 100)) { throw new Error('Invalid profile selection'); }
	const entries = new Map<string, IArniCustomProfileField>();
	const missingFields: string[] = [];
	for (const name of fields) {
		const normalized = name.trim().toLowerCase();
		const contact = /^(telegram|телеграм|tg)$/.test(normalized)
			? /^(?:(?:personal|work|личный|рабочий|мой|основной)\s+)?(?:telegram|телеграм|tg)(?:\s+(?:username|handle|профиль|аккаунт))?$/iu
			: /^(twitter|x|twitter\s*\/\s*x)$/.test(normalized)
				? /^(?:(?:personal|work|личный|рабочий|мой|основной)\s+)?(?:twitter|x|twitter\s*\/\s*x|x\s*\(twitter\)|x\.com)(?:\s+(?:profile|username|handle|профиль|аккаунт))?$/iu : undefined;
		const matches = contact ? profile.customFields.filter(field => contact.test(field.label)) : [];
		// Never choose between work/personal contacts or inspect values to guess.
		const entry = all.find(field => field.id === name) ?? all.find(field => field.label.toLowerCase() === normalized) ?? (matches.length === 1 ? matches[0] : undefined);
		if (entry) { entries.set(entry.id, entry); }
		if (!entry?.value) { missingFields.push(name); }
	}
	return { entries: [...entries.values()], missingFields };
}

export function selectArniProfileFields(values: ArniProfileValues, fields: readonly ArniProfileField[]): ArniProfileValues {
	const selected: ArniProfileValues = {};
	const requested: readonly ArniProfileField[] = fields;
	if (!Array.isArray(fields) || !fields.length || fields.length > arniProfileFields.length || fields.some(key => !arniProfileFields.some(field => field.key === key))) {
		throw new Error(localize('arni.profile.invalidSelection', 'Выберите известные поля карточки.'));
	}
	for (const key of requested) {
		if (values[key]) {
			selected[key] = values[key];
		}
	}
	return selected;
}
