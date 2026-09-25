/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../base/common/lifecycle.js';
import { CancellationTokenSource } from '../../base/common/cancellation.js';
import { IObservable, runOnChange } from '../../base/common/observable.js';
import { DeferredPromise } from '../../base/common/async.js';
import { createDecorator, IInstantiationService } from '../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../platform/storage/common/storage.js';
import { IUserDataProfileStorageService } from '../../platform/userDataProfile/common/userDataProfileStorageService.js';
import { IUserDataProfilesService } from '../../platform/userDataProfile/common/userDataProfile.js';
import { ServiceCollection } from '../../platform/instantiation/common/serviceCollection.js';
import { ChatEntitlementContext, IChatEntitlementService } from '../../workbench/services/chat/common/chatEntitlementService.js';
import { isWeb } from '../../base/common/platform.js';
import { IDefaultAccountService } from '../../platform/defaultAccount/common/defaultAccount.js';
import { IProductService } from '../../platform/product/common/productService.js';
import { IContextKeyService } from '../../platform/contextkey/common/contextkey.js';
import { IWorkbenchEnvironmentService } from '../../workbench/services/environment/common/environmentService.js';
import { IAuthenticationService } from '../../workbench/services/authentication/common/authentication.js';
import { hasArniProductSignIn } from '../../workbench/services/authentication/common/arniProductAuth.js';
import { ICommandService } from '../../platform/commands/common/commands.js';
import { IWorkbenchLayoutService } from '../../workbench/services/layout/browser/layoutService.js';
import { IKeybindingService } from '../../platform/keybinding/common/keybinding.js';
import { IHostService } from '../../workbench/services/host/browser/host.js';
import { WELCOME_COMPLETE_KEY } from '../common/welcome.js';
import { SessionsWelcomeVisibleContext } from '../common/contextkeys.js';
import { ConditionalAuthState, conditionalAuthState, observeAllowSignedOutWhenUsable, resolveSignedOutWindowGate, SignedOutWindowGate } from './sessionsAuthGate.js';

import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { Codicon } from '../../base/common/codicons.js';
import { Dialog, DialogContentsAlignment } from '../../base/browser/ui/dialog/dialog.js';
import { createWorkbenchDialogOptions } from '../../workbench/browser/parts/dialogs/dialog.js';
import { localize } from '../../nls.js';
import { createSessionsSignInDialogOptions, SessionsSigningInDialog } from './sessionsSignInDialog.js';
import { SHOULD_SHOW_RETURN_TO_VSCODE_EDITOR_COMMAND_ID } from '../common/sessionCommands.js';
import { ISessionsManagementService } from '../services/sessions/common/sessionsManagement.js';

const AIDisabledConfig = 'chat.disableAIFeatures';

export const ISessionsSetUpService = createDecorator<ISessionsSetUpService>('sessionsSetUpService');

export interface ISessionsSetUpService {
	readonly _serviceBrand: undefined;
	readonly initialSignInDialogShown: boolean;
	/**
	 * Resolves when the welcome/setup flow has completed (or immediately
	 * if it is not currently active). Use this to defer work until after
	 * the user has finished the initial sign-in or setup dialog.
	 */
	whenWelcomeDone(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal welcome widget — owns all the welcome UI logic.
// Receives service callbacks as constructor params to avoid circular injection.
// ---------------------------------------------------------------------------

function shouldSkipSessionsWelcome(environmentService: IWorkbenchEnvironmentService): boolean {
	if (environmentService.enableSmokeTestDriver) {
		return true;
	}
	const envArgs = (environmentService as IWorkbenchEnvironmentService & { args?: Record<string, unknown> }).args;
	if (envArgs?.['skip-sessions-welcome']) {
		return true;
	}
	return typeof globalThis.location !== 'undefined' && new URLSearchParams(globalThis.location.search).has('skip-sessions-welcome');
}

class SessionsSetUpWidget extends Disposable {

	private readonly dialogRef = this._register(new MutableDisposable<DisposableStore>());
	private readonly watcherRef = this._register(new MutableDisposable());
	private readonly signInSetupCancellation = this._register(new MutableDisposable<CancellationTokenSource>());
	private _initialSetupFlow = true;
	/** True while the window is open for a signed-out user via the conditional-auth opt-in. */
	private _proceedingSignedOut = false;
	/**
	 * Set once the initial default-account resolution has completed. Until then
	 * the synchronous {@link IDefaultAccountService.currentDefaultAccount} snapshot
	 * is `null` even for a signed-in user, so a `null` reading means "not known
	 * yet", not "signed out". The conditional-auth reaction stays inert until this
	 * flips, otherwise it forces a sign-in modal on a signed-in user during the
	 * startup gap — one nothing can retire, since the account resolves silently.
	 */
	private _accountResolved = false;
	private _waitingForSessionTypes = false;
	/** Whether the window may proceed without GitHub sign-in. */
	private readonly _allowSignedOutWhenUsable: IObservable<boolean>;

	// Non-service params must come before @-decorated service params
	constructor(
		private readonly onCompleted: () => void,
		_serviceWhenSetupDone: () => Promise<boolean>,
		private readonly serviceMarkDone: () => void,
		private readonly onInitialSignInDialogShown: () => void,
		@IDefaultAccountService private readonly defaultAccountService: IDefaultAccountService,
		@IProductService private readonly productService: IProductService,
		@IStorageService private readonly storageService: IStorageService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@ILogService private readonly logService: ILogService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IHostService private readonly hostService: IHostService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
	) {
		super();
		this._allowSignedOutWhenUsable = observeAllowSignedOutWhenUsable(this.configurationService);
		this._register(runOnChange(this._allowSignedOutWhenUsable, () => this._onAllowSignedOutWhenUsableChanged()));
		this._register(this.sessionsManagementService.onDidChangeSessionTypes(() => this._onSessionTypesChanged()));
		this._start();
	}

	private _onSessionTypesChanged(): void {
		const signedIn = this.defaultAccountService.currentDefaultAccount !== null;
		if (conditionalAuthState(this._accountResolved, signedIn) === ConditionalAuthState.SignedOut) {
			this._reevaluateSignedOut();
		}
	}

	/**
	 * The opt-in was toggled while the window is open. Ignored until the account
	 * has resolved (see {@link _accountResolved}) and for signed-in users. For a
	 * signed-out user, turning it on retires an already-open sign-in modal (it was
	 * raised before the account resolved); turning it off falls back to demanding
	 * sign-in.
	 */
	private _onAllowSignedOutWhenUsableChanged(): void {
		// Only act once the account has resolved AND the user is signed out; while
		// unresolved or signed in, the sign-in watch owns the decision.
		const signedIn = this.defaultAccountService.currentDefaultAccount !== null;
		if (conditionalAuthState(this._accountResolved, signedIn) !== ConditionalAuthState.SignedOut) {
			return;
		}
		this._reevaluateSignedOut();
	}

	private _start(): void {
		if (!this.productService.defaultChatAgent?.chatExtensionId) {
			this.onCompleted();
			return;
		}

		if (shouldSkipSessionsWelcome(this.environmentService)) {
			this.onCompleted();
			return;
		}

		// Learn when the default account resolves so the conditional-auth reaction
		// can tell "signed out" from "not resolved yet". On first load the account
		// is populated silently (no change event fires), so awaiting it once is the
		// only signal that resolution has happened.
		this.defaultAccountService.getDefaultAccount().then(() => {
			if (this._store.isDisposed) {
				return;
			}
			this._accountResolved = true;
			// The initial setup flow re-reads the setting after this account promise.
			if (!this._initialSetupFlow && this._allowSignedOutWhenUsable.get()) {
				this._onAllowSignedOutWhenUsableChanged();
			}
		});

		if (isWeb) {
			void this._checkWebAuth().finally(() => this._initialSetupFlow = false);
			this._watchWebAuth();
			return;
		}

		const isFirstLaunch = !this.storageService.getBoolean(WELCOME_COMPLETE_KEY, StorageScope.APPLICATION, false);

		if (isFirstLaunch) {
			void this._showWelcome(true).finally(() => this._initialSetupFlow = false);
		} else {
			void this._watchSignInState().finally(() => this._initialSetupFlow = false);
		}
	}

	private async _checkWebAuth(): Promise<void> {
		try {
			const sessions = await this.authenticationService.getSessions('github');
			if (sessions.length > 0) {
				this.logService.info('[sessions welcome] GitHub session found on web, skipping welcome');
				this.storageService.store(WELCOME_COMPLETE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
				this.onCompleted();
				return;
			}
		} catch {
			// Provider not available yet — show dialog
		}
		this._showWelcome(false);
	}

	private _watchWebAuth(): void {
		this._register(this.authenticationService.onDidChangeSessions(async e => {
			if (e.providerId !== 'github' || !e.event.removed?.length) {
				return;
			}
			try {
				const remaining = await this.authenticationService.getSessions('github');
				if (remaining.length > 0) {
					return;
				}
			} catch {
				// Provider became unavailable — treat as signed out
			}
			this.logService.info('[sessions welcome] GitHub session removed on web, re-showing welcome');
			this.storageService.remove(WELCOME_COMPLETE_KEY, StorageScope.APPLICATION);
			this._showWelcome(false);
		}));
	}

	/**
	 * Yandex and VK sessions are the product sign-in. The GitHub default
	 * account is optional and must not keep the Agents window on the sign-in modal.
	 */
	private async _hasArniSignIn(): Promise<boolean> {
		return hasArniProductSignIn(this.authenticationService);
	}

	private async _watchSignInState(): Promise<void> {
		const arniSignIn = await this._hasArniSignIn();
		if (this.dialogRef.value) {
			return;
		}
		if (!arniSignIn) {
			// Arni requires Yandex/VK before Agents chat. Never continue signed-out.
			this._showWelcome(false);
			return;
		}
		await this._ensureAIFeaturesEnabled();
		this.onCompleted();
		this.watcherRef.value = this._watchActiveState(true);
	}

	private _watchActiveState(signedIn: boolean): IDisposable {
		const disposables = new DisposableStore();

		disposables.add(this.authenticationService.onDidChangeSessions(async e => {
			if (e.providerId === 'yandex' || e.providerId === 'vk') {
				const hasSignIn = await this._hasArniSignIn();
				if (!hasSignIn) {
					this.storageService.remove(WELCOME_COMPLETE_KEY, StorageScope.APPLICATION);
					this.dialogRef.clear();
					void this._showWelcome(false);
				}
			}
		}));

		disposables.add(this.defaultAccountService.onDidChangeDefaultAccount(account => {
			const nowSignedIn = account !== null;
			if (signedIn && !nowSignedIn) {
				// Signed out: drop the completion marker and re-consult the gate.
				this.storageService.remove(WELCOME_COMPLETE_KEY, StorageScope.APPLICATION);
				this._reevaluateSignedOut();
			} else if (!signedIn && nowSignedIn) {
				// Signed in while running signed-out: the window is already open.
				this._proceedingSignedOut = false;
			}
			signedIn = nowSignedIn;
		}));

		disposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AIDisabledConfig)) {
				if (this.configurationService.getValue<boolean>(AIDisabledConfig)) {
					this._showAIDisabledDialog();
				} else {
					// AI features re-enabled — dismiss any AI disabled dialog
					this.dialogRef.clear();
				}
			}
		}));

		return disposables;
	}

	/**
	 * Resolve the window-level signed-out gate from the opt-in and the live auth
	 * requirement of every advertised session type.
	 */
	private _signedOutWindowGate(): SignedOutWindowGate {
		return resolveSignedOutWindowGate(
			this._allowSignedOutWhenUsable.get(),
			this.sessionsManagementService.getAllProviderSessionTypes().map(({ sessionType }) => sessionType.authRequirement),
		);
	}

	/**
	 * Re-run the signed-out decision after an input change: force GitHub sign-in
	 * when the gate demands it, otherwise open the window without GitHub. A no-op
	 * while a dialog is up — that dialog owns the next transition.
	 */
	private _reevaluateSignedOut(): void {
		if (this._initialSetupFlow) {
			return;
		}
		if (this._proceedingSignedOut && this._allowSignedOutWhenUsable.get()) {
			return;
		}
		const gate = this._signedOutWindowGate();
		if (gate === SignedOutWindowGate.Unresolved) {
			this._waitingForSessionTypes = true;
			return;
		}
		if (this._waitingForSessionTypes) {
			this._waitingForSessionTypes = false;
			this.dialogRef.clear();
		}
		if (gate === SignedOutWindowGate.ForceGitHubSignIn) {
			if (this.dialogRef.value) {
				return;
			}
			this._proceedingSignedOut = false;
			void this._showWelcome(false);
		} else {
			this.signInSetupCancellation.value?.cancel();
			this.dialogRef.clear();
			void this._proceedWithoutGitHub();
		}
	}

	/**
	 * Open the Agents window for a signed-out user because the opt-in permits it.
	 * Mirrors the signed-in completion path and remains active until sign-in or the
	 * opt-in changes. Idempotent while already proceeding.
	 */
	private async _proceedWithoutGitHub(): Promise<void> {
		if (this._proceedingSignedOut) {
			return;
		}
		this._proceedingSignedOut = true;
		this.logService.info('[sessions welcome] Proceeding without GitHub sign-in; signed-out operation is enabled');
		await this._ensureAIFeaturesEnabled();
		if (this._store.isDisposed) {
			return;
		}
		this.onCompleted();
		this.watcherRef.value = this._watchActiveState(false);
	}

	private async _ensureAIFeaturesEnabled(): Promise<void> {
		if (this.configurationService.getValue<boolean>(AIDisabledConfig)) {
			this.logService.info('[sessions welcome] AI features disabled, enabling');
			await this.configurationService.updateValue(AIDisabledConfig, false);
		}
	}

	private async _showAIDisabledDialog(): Promise<void> {
		if (this.dialogRef.value) {
			return;
		}

		this.logService.info('[sessions welcome] AI features disabled, showing enable dialog');

		const disposables = new DisposableStore();
		this.dialogRef.value = disposables;

		const welcomeVisibleKey = SessionsWelcomeVisibleContext.bindTo(this.contextKeyService);
		welcomeVisibleKey.set(true);
		disposables.add(toDisposable(() => welcomeVisibleKey.reset()));

		const dialog = disposables.add(new Dialog(
			this.layoutService.activeContainer,
			'',
			[localize('sessions.aiDisabled.enable', "Enable AI Features")],
			createWorkbenchDialogOptions({
				type: 'none',
				extraClasses: ['chat-setup-dialog', 'sessions-welcome-dialog'],
				detail: localize('sessions.aiDisabled.detail', "Enable AI features to continue using Agents."),
				icon: Codicon.agent,
				alignment: DialogContentsAlignment.Vertical,
				cancelId: 1,
				disableCloseButton: true,
				disableCloseAction: true,
			}, this.keybindingService, this.layoutService, this.hostService)
		));

		const { button } = await dialog.show();
		disposables.dispose();
		this.dialogRef.clear();

		if (button === 0) {
			this.logService.info('[sessions welcome] User chose to enable AI features');
			await this.configurationService.updateValue(AIDisabledConfig, false);
		}
	}

	private async _showWelcome(isFirstLaunch: boolean): Promise<void> {
		if (await this._hasArniSignIn()) {
			this.storageService.store(WELCOME_COMPLETE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
			this.serviceMarkDone();
			this.dialogRef.clear();
			await this._ensureAIFeaturesEnabled();
			if (this._store.isDisposed) {
				return;
			}
			this.onCompleted();
			this.watcherRef.value = this._watchActiveState(true);
			return;
		}

		if (this.dialogRef.value) {
			return;
		}

		this.watcherRef.clear();
		this.dialogRef.value = new DisposableStore();

		const welcomeVisibleKey = SessionsWelcomeVisibleContext.bindTo(this.contextKeyService);
		welcomeVisibleKey.set(true);
		this.dialogRef.value.add(toDisposable(() => welcomeVisibleKey.reset()));

		await this._showSignInDialog(false);

		this.dialogRef.clear();
		await this._ensureAIFeaturesEnabled();
		this._watchSignInState();
	}

	private async _showSignInDialog(allowContinueWithoutSignIn = false): Promise<boolean> {
		if (this._initialSetupFlow) {
			this.onInitialSignInDialogShown();
		}
		this.logService.info('[sessions welcome] Showing sign-in dialog');

		const setupCancellation = new CancellationTokenSource();
		this.signInSetupCancellation.value = setupCancellation;
		while (true) {
			const attemptDisposables = new DisposableStore();
			const signingInDialogRef = attemptDisposables.add(new MutableDisposable<SessionsSigningInDialog>());
			let canceled = false;
			let continueWithoutSignIn = false;
			const showReturnToVSCodeEditor = !isWeb && (await this.commandService.executeCommand<boolean>(SHOULD_SHOW_RETURN_TO_VSCODE_EDITOR_COMMAND_ID)) === true;
			const onContinueWithoutSignIn = () => {
				if (!this._allowSignedOutWhenUsable.get()) {
					return;
				}
				continueWithoutSignIn = true;
				setupCancellation.cancel();
			};

			let success: boolean | undefined;
			try {
				success = await this.commandService.executeCommand<boolean>('workbench.action.chat.triggerSetup', undefined, {
					...createSessionsSignInDialogOptions(this.commandService, showReturnToVSCodeEditor, allowContinueWithoutSignIn, onContinueWithoutSignIn),
					cancellationToken: setupCancellation.token,
					onSignInStarted: (cancel: () => void) => {
						signingInDialogRef.value = this.instantiationService.createInstance(SessionsSigningInDialog, () => {
							canceled = true;
							cancel();
						});
					}
				});
			} finally {
				attemptDisposables.dispose();
			}
			if (continueWithoutSignIn) {
				this.logService.info('[sessions welcome] User chose to continue without GitHub sign-in');
				this.signInSetupCancellation.clear();
				return true;
			}
			if (setupCancellation.token.isCancellationRequested) {
				this.logService.info('[sessions welcome] Sign-in dialog retired because another agent became usable');
				this.signInSetupCancellation.clear();
				return false;
			}

			if (canceled) {
				this.logService.info('[sessions welcome] Sign-in canceled; returning to sign-in dialog');
				continue;
			}

			if (success) {
				this.logService.info('[sessions welcome] Sign-in completed successfully');
				this.storageService.store(WELCOME_COMPLETE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
				this.serviceMarkDone();
			} else {
				this.logService.info('[sessions welcome] Sign-in was canceled or failed');
			}
			this.signInSetupCancellation.clear();
			return false;
		}
	}
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SessionsSetUpService extends Disposable implements ISessionsSetUpService {

	declare readonly _serviceBrand: undefined;

	private readonly _initPromise: Promise<void>;
	private readonly _welcomeDoneDeferred = new DeferredPromise<void>();
	private _initialSignInDialogShown = false;

	get initialSignInDialogShown(): boolean {
		return this._initialSignInDialogShown;
	}

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IUserDataProfileStorageService private readonly userDataProfileStorageService: IUserDataProfileStorageService,
		@IUserDataProfilesService private readonly userDataProfilesService: IUserDataProfilesService,
		@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		this._initPromise = this.initialize();

		this._register(this.instantiationService.createInstance(
			SessionsSetUpWidget,
			() => this._welcomeDoneDeferred.complete(),
			() => this.whenSetupDone(),
			() => this.markDone(),
			() => this._initialSignInDialogShown = true
		));
	}

	private async whenSetupDone(): Promise<boolean> {
		await this._initPromise;
		return this.chatEntitlementService.sentiment.completed === true;
	}

	private markDone(): void {
		this.chatEntitlementService.markSetupCompleted();
	}

	whenWelcomeDone(): Promise<void> {
		return this._welcomeDoneDeferred.p;
	}

	private async initialize(): Promise<void> {
		if (this.chatEntitlementService.sentiment.completed) {
			return;
		}

		try {
			const defaultProfile = this.userDataProfilesService.defaultProfile;
			await this.userDataProfileStorageService.withProfileScopedStorageService(defaultProfile, async storageService => {
				const defaultContext = this.instantiationService
					.createChild(new ServiceCollection([IStorageService, storageService]))
					.createInstance(ChatEntitlementContext);
				try {
					if (defaultContext.state.completed) {
						this.logService.info('[sessions welcome] Setup already completed in default profile, marking done locally');
						this.markDone();
					}
				} finally {
					defaultContext.dispose();
				}
			});
		} catch (error) {
			this.logService.error('[sessions welcome] Failed to read setup state from default profile:', error);
		}
	}
}
