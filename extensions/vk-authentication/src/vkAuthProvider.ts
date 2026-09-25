import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import { ensureLocalhostCertificate } from './localhostCertificate';
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

const SESSIONS_SECRET_KEY = 'vk.auth.sessions';
const DEFAULT_PORT = 443;
// Baked into the build, same as the Yandex client id. End users do not set this.
// No client secret: a secret shipped in a desktop build is public. The code
// exchange is bound to this client by PKCE (code_verifier) instead.
const DEFAULT_CLIENT_ID = '54785916';

export class VkAuthenticationProvider implements vscode.AuthenticationProvider, vscode.Disposable {
    private _onDidChangeSessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
    readonly onDidChangeSessions = this._onDidChangeSessions.event;

    private readonly _disposable: vscode.Disposable;

    constructor(private readonly context: vscode.ExtensionContext) {
        this._disposable = vscode.authentication.registerAuthenticationProvider(
            'vk',
            'VK ID',
            this,
            { supportsMultipleAccounts: false }
        );
    }

    async getSessions(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
        const stored = await this.readStoredSessions();
        if (!scopes || scopes.length === 0) {
            return stored;
        }
        return stored.filter(session => scopes.every(scope => session.scopes.includes(scope)));
    }

    async createSession(scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
        const config = vscode.workspace.getConfiguration('vk');
        const clientId = config.get<string>('clientId')?.trim() || DEFAULT_CLIENT_ID;
        if (!clientId) {
            throw new Error('Вход через VK ещё не подключён в этой сборке.');
        }
        const preferredPort = config.get<number>('redirectPort') || DEFAULT_PORT;
        const effectiveScopes = scopes && scopes.length > 0
            ? Array.from(new Set(scopes))
            : ['vkid.personal_info', 'email'];

        const tls = await ensureLocalhostCertificate(this.context);
        const loopback = new LoopbackServer();
        let port: number;
        try {
            port = await loopback.start(preferredPort, tls);
        } catch (err: any) {
            throw new Error(
                preferredPort === DEFAULT_PORT
                    ? 'Не удалось занять порт 443. VK ID для локальной проверки ждёт https://localhost. Закройте программу на порту 443 или запустите Arni Code от имени администратора.'
                    : `Не удалось запустить локальный сервер авторизации: ${err.message}`
            );
        }

        const redirectUri = port === DEFAULT_PORT
            ? 'https://localhost'
            : `https://localhost:${port}/callback`;
        const state = crypto.randomBytes(16).toString('hex');
        const codeVerifier = crypto.randomBytes(32).toString('base64url');
        const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

        const authUrl = new URL('https://id.vk.ru/authorize');
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', effectiveScopes.join(' '));
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');

        await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

        let authCode: string;
        let deviceId: string;
        try {
            const result = await loopback.waitForCode(state);
            authCode = result.code;
            deviceId = result.deviceId;
        } catch (error) {
            loopback.stop();
            throw error;
        }

        const tokenParams = new URLSearchParams();
        tokenParams.set('grant_type', 'authorization_code');
        tokenParams.set('code', authCode);
        tokenParams.set('code_verifier', codeVerifier);
        tokenParams.set('client_id', clientId);
        tokenParams.set('device_id', deviceId);
        tokenParams.set('redirect_uri', redirectUri);
        tokenParams.set('state', state);

        const tokenResponse = await fetch('https://id.vk.ru/oauth2/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenParams.toString()
        });

        if (!tokenResponse.ok) {
            const errText = await tokenResponse.text();
            throw new Error(`Ошибка обмена токена VK (${tokenResponse.status}): ${errText}`);
        }

        const tokenData: any = await tokenResponse.json();
        const accessToken = tokenData.access_token as string | undefined;
        if (!accessToken) {
            throw new Error('VK не вернул access_token');
        }
        const refreshToken = tokenData.refresh_token as string | undefined;
        const expiresIn = tokenData.expires_in as number | undefined;

        const profile = await this.readProfile(clientId, accessToken);
        const accountLabel = profile.email ? `${profile.displayName} (${profile.email})` : profile.displayName;

        const session: StoredSession = {
            id: crypto.randomUUID(),
            account: {
                id: profile.id,
                label: accountLabel
            },
            scopes: effectiveScopes,
            accessToken,
            refreshToken,
            expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined
        };

        await this.storeSession(session);
        this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
        vscode.window.showInformationMessage(`Успешный вход через VK: ${accountLabel}`);
        return session;
    }

    async removeSession(sessionId: string): Promise<void> {
        const stored = await this.readStoredSessions();
        const sessionIndex = stored.findIndex(session => session.id === sessionId);
        if (sessionIndex >= 0) {
            const removed = stored.splice(sessionIndex, 1);
            await this.writeStoredSessions(stored);
            this._onDidChangeSessions.fire({ added: [], removed, changed: [] });
            vscode.window.showInformationMessage('Вы вышли из аккаунта VK.');
        }
    }

    private async readProfile(clientId: string, accessToken: string): Promise<{ id: string; displayName: string; email: string }> {
        const body = new URLSearchParams();
        body.set('client_id', clientId);
        body.set('access_token', accessToken);
        const response = await fetch('https://id.vk.ru/oauth2/user_info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });
        if (!response.ok) {
            throw new Error(`Не удалось получить профиль VK: ${response.statusText}`);
        }
        const payload: any = await response.json();
        const user = payload.user || payload.response?.user || payload;
        const id = String(user.user_id || user.id || crypto.randomUUID());
        const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.name || 'Пользователь VK';
        const email = user.email || '';
        return { id, displayName, email };
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
        const filtered = existing.filter(item => item.account.id !== session.account.id);
        filtered.push(session);
        await this.writeStoredSessions(filtered);
    }

    dispose() {
        this._disposable.dispose();
        this._onDidChangeSessions.dispose();
    }
}
