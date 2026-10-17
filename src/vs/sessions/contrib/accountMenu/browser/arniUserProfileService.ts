/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IDefaultAccountService } from '../../../../platform/defaultAccount/common/defaultAccount.js';
import { IEncryptionService, KnownStorageProvider } from '../../../../platform/encryption/common/encryptionService.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { AuthenticationSession, IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import { ARNI_PRODUCT_AUTH_PROVIDERS } from '../../../../workbench/services/authentication/common/arniProductAuth.js';
import { ArniProfileValues, IArniUserProfile, parseArniProfile, validateArniProfile } from '../common/arniUserProfile.js';

export interface IArniProfileAccount {
	readonly key: string;
	readonly label: string;
	readonly generation: number;
}

export const IArniUserProfileService = createDecorator<IArniUserProfileService>('arniUserProfileService');
export interface IArniUserProfileService {
	readonly _serviceBrand: undefined;
	getAccount(): Promise<IArniProfileAccount>;
	assertAccount(account: IArniProfileAccount): Promise<void>;
	read(account: IArniProfileAccount): Promise<IArniUserProfile>;
	save(account: IArniProfileAccount, values: ArniProfileValues): Promise<void>;
	clear(account: IArniProfileAccount): Promise<void>;
}

/** Local card partitioned by stable product identity, never by workspace or display name. */
export class ArniUserProfileService extends Disposable implements IArniUserProfileService {
	declare readonly _serviceBrand: undefined;
	private generation = 0;

	constructor(
		@IAuthenticationService private readonly authentication: IAuthenticationService,
		@IDefaultAccountService private readonly defaultAccount: IDefaultAccountService,
		@ISecretStorageService private readonly secrets: ISecretStorageService,
		@IEncryptionService private readonly encryption: IEncryptionService,
	) {
		super();
		this._register(authentication.onDidChangeSessions(() => this.generation++));
	}

	async getAccount(): Promise<IArniProfileAccount> {
		const generation = this.generation;
		const preferred = await this.defaultAccount.getDefaultAccount();
		const providers = [...ARNI_PRODUCT_AUTH_PROVIDERS].sort((a, b) => Number(b.id === preferred?.authenticationProvider.id) - Number(a.id === preferred?.authenticationProvider.id));
		for (const provider of providers) {
			let sessions: readonly AuthenticationSession[];
			try {
				sessions = await this.authentication.getSessions(provider.id);
			} catch {
				continue;
			}
			const session = preferred?.authenticationProvider.id === provider.id
				? sessions.find(session => session.id === preferred.sessionId)
				: sessions[0];
			if (session && generation === this.generation) {
				return { key: JSON.stringify([provider.id, session.account.id]), label: session.account.label, generation };
			}
		}
		throw new Error(localize('arni.profile.signIn', 'Войдите в аккаунт Arni через Яндекс или VK, затем откройте «Мои данные».'));
	}

	async assertAccount(account: IArniProfileAccount): Promise<void> {
		const current = await this.getAccount();
		if (current.key !== account.key || current.generation !== account.generation) {
			throw new Error(localize('arni.profile.accountChanged', 'Аккаунт изменился. Откройте карточку заново.'));
		}
	}

	private async storageKey(account: IArniProfileAccount): Promise<string> {
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(account.key));
		return 'arni.personalCard.v1.' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
	}

	async read(account: IArniProfileAccount): Promise<IArniUserProfile> {
		await this.assertAccount(account);
		const text = await this.secrets.get(await this.storageKey(account));
		await this.assertAccount(account);
		return parseArniProfile(text);
	}

	async save(account: IArniProfileAccount, values: ArniProfileValues): Promise<void> {
		const validated = validateArniProfile(values);
		if (!await this.encryption.isEncryptionAvailable() || await this.encryption.getKeyStorageProvider() === KnownStorageProvider.basicText) {
			throw new Error(localize('arni.profile.encryption', 'Защищённое хранилище недоступно. Карточка не сохранена.'));
		}
		await this.assertAccount(account);
		const key = await this.storageKey(account);
		await this.assertAccount(account);
		await this.secrets.set(key, JSON.stringify({ schemaVersion: 1, values: validated }));
		await this.assertAccount(account);
	}

	async clear(account: IArniProfileAccount): Promise<void> {
		const key = await this.storageKey(account);
		await this.assertAccount(account);
		await this.secrets.delete(key);
		await this.assertAccount(account);
	}
}
