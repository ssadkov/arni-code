import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import { LoopbackServer } from './loopbackServer';

interface StoredSession {
    id: string;
    account: {
        id: string;
        label: string;
    };
    scopes: string[];
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
}

const SESSIONS_SECRET_KEY = 'yandex.auth.sessions';
const DEFAULT_CLIENT_ID = 'arni-code-yandex-client'; // Placeholder or configured in settings

export class YandexAuthenticationProvider implements vscode.AuthenticationProvider, vscode.Disposable {
    private _onDidChangeSessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
    readonly onDidChangeSessions = this._onDidChangeSessions.event;

    private readonly _disposable: vscode.Disposable;

    constructor(private readonly context: vscode.ExtensionContext) {
        this._disposable = vscode.authentication.registerAuthenticationProvider(
            'yandex',
            'Яндекс ID',
            this,
            { supportsMultipleAccounts: false }
        );
    }

    async getSessions(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
        const stored = await this.readStoredSessions();
        if (!scopes || scopes.length === 0) {
            return stored;
        }
        return stored.filter(s => scopes.every(scope => s.scopes.includes(scope)));
    }

    async createSession(scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
        const config = vscode.workspace.getConfiguration('yandex');
        let clientId = config.get<string>('clientId')?.trim() || '';
        const clientSecret = config.get<string>('clientSecret')?.trim() || '';

        if (!clientId) {
            // Check if user wants to enter client ID or use default
            const userChoice = await vscode.window.showInformationMessage(
                'Для авторизации через Яндекс ID требуется Client ID приложения в Яндекс OAuth.',
                'Указать Client ID',
                'Создать приложение в Яндекс OAuth',
                'Продолжить с тестовым'
            );

            if (userChoice === 'Указать Client ID') {
                const input = await vscode.window.showInputBox({
                    title: 'Яндекс OAuth Client ID',
                    prompt: 'Введите Client ID вашего приложения из https://oauth.yandex.ru/',
                    ignoreFocusOut: true
                });
                if (input?.trim()) {
                    clientId = input.trim();
                    await config.update('clientId', clientId, vscode.ConfigurationTarget.Global);
                } else {
                    throw new Error('Авторизация отменена: не указан Client ID');
                }
            } else if (userChoice === 'Создать приложение в Яндекс OAuth') {
                await vscode.env.openExternal(vscode.Uri.parse('https://oauth.yandex.ru/client/new'));
                throw new Error('Зарегистрируйте приложение в Яндекс OAuth и укажите Client ID в настройках');
            } else if (userChoice === 'Продолжить с тестовым') {
                clientId = DEFAULT_CLIENT_ID;
            } else {
                throw new Error('Авторизация отменена');
            }
        }

        const effectiveScopes = scopes && scopes.length > 0
            ? Array.from(new Set([...scopes, 'login:info', 'login:email']))
            : ['login:info', 'login:email', 'login:avatar'];

        // Start loopback server
        const loopback = new LoopbackServer();
        let port: number;
        try {
            port = await loopback.start();
        } catch (err: any) {
            throw new Error(`Не удалось запустить локальный сервер авторизации: ${err.message}`);
        }

        const redirectUri = `http://127.0.0.1:${port}/callback`;
        const state = crypto.randomBytes(16).toString('hex');
        const codeVerifier = crypto.randomBytes(32).toString('base64url');
        const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

        // Construct authorization URL
        const authUrl = new URL('https://oauth.yandex.ru/authorize');
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', effectiveScopes.join(' '));
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');

        // Open in browser
        await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

        // Wait for loopback callback
        let authCode: string;
        try {
            const result = await loopback.waitForCode(state);
            authCode = result.code;
        } catch (error: any) {
            loopback.stop();
            throw error;
        }

        // Exchange code for tokens
        const tokenParams = new URLSearchParams();
        tokenParams.set('grant_type', 'authorization_code');
        tokenParams.set('code', authCode);
        tokenParams.set('client_id', clientId);
        if (clientSecret) {
            tokenParams.set('client_secret', clientSecret);
        }
        tokenParams.set('code_verifier', codeVerifier);
        tokenParams.set('redirect_uri', redirectUri);

        const tokenResponse = await fetch('https://oauth.yandex.ru/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: tokenParams.toString()
        });

        if (!tokenResponse.ok) {
            const errText = await tokenResponse.text();
            throw new Error(`Ошибка обмена токена Яндекс (${tokenResponse.status}): ${errText}`);
        }

        const tokenData: any = await tokenResponse.json();
        const accessToken = tokenData.access_token;
        const refreshToken = tokenData.refresh_token;
        const expiresIn = tokenData.expires_in;

        // Fetch user profile from Yandex
        const userInfoResponse = await fetch('https://login.yandex.ru/info?format=json', {
            headers: {
                'Authorization': `OAuth ${accessToken}`
            }
        });

        if (!userInfoResponse.ok) {
            throw new Error(`Не удалось получить данные профиля Яндекс: ${userInfoResponse.statusText}`);
        }

        const userInfo: any = await userInfoResponse.json();
        const yandexId = userInfo.id || crypto.randomUUID();
        const displayName = userInfo.real_name || userInfo.display_name || userInfo.login || 'Пользователь Яндекс';
        const email = userInfo.default_email || (userInfo.emails && userInfo.emails[0]) || '';
        const accountLabel = email ? `${displayName} (${email})` : displayName;

        const session: StoredSession = {
            id: crypto.randomUUID(),
            account: {
                id: yandexId,
                label: accountLabel
            },
            scopes: effectiveScopes,
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined
        };

        await this.storeSession(session);

        this._onDidChangeSessions.fire({
            added: [session],
            removed: [],
            changed: []
        });

        vscode.window.showInformationMessage(`Успешный вход в Яндекс ID: ${accountLabel}`);
        return session;
    }

    async removeSession(sessionId: string): Promise<void> {
        const stored = await this.readStoredSessions();
        const sessionIndex = stored.findIndex(s => s.id === sessionId);
        if (sessionIndex >= 0) {
            const removed = stored.splice(sessionIndex, 1);
            await this.writeStoredSessions(stored);
            this._onDidChangeSessions.fire({
                added: [],
                removed: removed,
                changed: []
            });
            vscode.window.showInformationMessage('Вы вышли из аккаунта Яндекс ID.');
        }
    }

    private async readStoredSessions(): Promise<StoredSession[]> {
        const raw = await this.context.secrets.get(SESSIONS_SECRET_KEY);
        if (!raw) {
            return [];
        }
        try {
            return JSON.parse(raw);
        } catch {
            return [];
        }
    }

    private async writeStoredSessions(sessions: StoredSession[]): Promise<void> {
        await this.context.secrets.store(SESSIONS_SECRET_KEY, JSON.stringify(sessions));
    }

    private async storeSession(session: StoredSession): Promise<void> {
        const existing = await this.readStoredSessions();
        // Currently single account supported: replace or append
        const filtered = existing.filter(s => s.account.id !== session.account.id);
        filtered.push(session);
        await this.writeStoredSessions(filtered);
    }

    dispose() {
        this._disposable.dispose();
        this._onDidChangeSessions.dispose();
    }
}
