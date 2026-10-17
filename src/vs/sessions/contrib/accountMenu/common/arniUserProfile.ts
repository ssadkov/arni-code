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
export interface IArniUserProfile {
	readonly schemaVersion: 1;
	readonly values: ArniProfileValues;
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
		return { schemaVersion: 1, values: {} };
	}
	if (text.length > 20000) {
		throw new Error(localize('arni.profile.tooLarge', 'Карточка превышает допустимый размер.'));
	}
	const data: IArniUserProfile = JSON.parse(text);
	if (data?.schemaVersion !== 1) {
		throw new Error(localize('arni.profile.version', 'Версия карточки не поддерживается.'));
	}
	return { schemaVersion: 1, values: validateArniProfile(data.values) };
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
