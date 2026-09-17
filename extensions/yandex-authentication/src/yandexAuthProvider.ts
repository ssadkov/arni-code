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

interface YandexTokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
}

interface YandexUserInfo {
    id?: string;
    real_name?: string;
    display_name?: string;
    login?: string;
    default_email?: string;
    emails?: string[];
}

const SESSIONS_SECRET_KEY = 'yandex.auth.sessions';
const DEFAULT_CLIENT_ID = '5255b6b242694d51b97d71483148321f';
const REFRESH_SKEW_MS = 60_000;

export class YandexAuthenticationProvider implements vscode.AuthenticationProvider, vscode.Disposable {
    private _onDidChangeSessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
    readonly onDidChangeSessions = this._onDidChangeSessions.event;

    private readonly _disposable: vscode.Disposable;
    private readonly _refreshInFlight = new Map<string, Promise<StoredSession | undefined>>();

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
        const fresh: StoredSession[] = [];
        for (const session of stored) {
            const next = await this.ensureFreshSession(session);
            if (next) {
                fresh.push(next);
            }
        }
        if (!scopes || scopes.length === 0) {
            return fresh;
        }
        return fresh.filter(s => scopes.every(scope => s.scopes.includes(scope)));
    }

    async createSession(scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
        const { clientId, clientSecret } = this.readClientConfig();

        const effectiveScopes = scopes && scopes.length > 0
            ? Array.from(new Set([...scopes, 'login:info', 'login:email']))
            : ['login:info', 'login:email', 'login:avatar'];

        const loopback = new LoopbackServer();
        let port: number;
        try {
            port = await loopback.start();
        } catch (err: any) {
            throw new Error(`Failed to start the local authorization server: ${err.message}`);
        }

        const redirectUri = `http://127.0.0.1:${port}/callback`;
        const state = crypto.randomBytes(16).toString('hex');
        const codeVerifier = crypto.randomBytes(32).toString('base64url');
        const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

        const authUrl = new URL('https://oauth.yandex.ru/authorize');
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', effectiveScopes.join(' '));
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');

        // Start waiting before opening the browser so a fast Yandex redirect cannot race the handler.
        const codePromise = loopback.waitForCode(state);
        await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

        let authCode: string;
        try {
            const result = await codePromise;
            authCode = result.code;
        } catch (error: any) {
            loopback.stop();
            throw error;
        }

        try {
            const tokenData = await this.requestYandexToken({
                grant_type: 'authorization_code',
                code: authCode,
                client_id: clientId,
                client_secret: clientSecret,
                code_verifier: codeVerifier,
                redirect_uri: redirectUri
            });

            const accessToken = tokenData.access_token;
            if (!accessToken) {
                throw new Error('Yandex token response did not include access_token');
            }

            const userInfoResponse = await fetch('https://login.yandex.ru/info?format=json', {
                headers: {
                    'Authorization': `OAuth ${accessToken}`
                }
            });

            if (!userInfoResponse.ok) {
                throw new Error(`Failed to fetch Yandex profile: ${userInfoResponse.statusText}`);
            }

            const userInfo = await userInfoResponse.json() as YandexUserInfo;
            const yandexId = userInfo.id || crypto.randomUUID();
            const displayName = userInfo.real_name || userInfo.display_name || userInfo.login || 'Yandex user';
            const email = userInfo.default_email || (userInfo.emails && userInfo.emails[0]) || '';
            const accountLabel = email ? `${displayName} (${email})` : displayName;

            const session: StoredSession = {
                id: crypto.randomUUID(),
                account: {
                    id: yandexId,
                    label: accountLabel
                },
                scopes: effectiveScopes,
                accessToken,
                refreshToken: tokenData.refresh_token,
                expiresAt: tokenData.expires_in ? Date.now() + Number(tokenData.expires_in) * 1000 : undefined
            };

            await this.storeSession(session);

            this._onDidChangeSessions.fire({
                added: [session],
                removed: [],
                changed: []
            });

            vscode.window.showInformationMessage(`Signed in with Yandex ID: ${accountLabel}`);
            return session;
        } finally {
            loopback.stop();
        }
    }

    async removeSession(sessionId: string): Promise<void> {
        await this.dropSession(sessionId, true);
    }

    private readClientConfig(): { clientId: string; clientSecret: string } {
        const config = vscode.workspace.getConfiguration('yandex');
        return {
            clientId: config.get<string>('clientId')?.trim() || DEFAULT_CLIENT_ID,
            clientSecret: config.get<string>('clientSecret')?.trim() || ''
        };
    }

    private async ensureFreshSession(session: StoredSession): Promise<StoredSession | undefined> {
        if (!session.expiresAt || session.expiresAt - REFRESH_SKEW_MS > Date.now()) {
            return session;
        }

        const inFlight = this._refreshInFlight.get(session.id);
        if (inFlight) {
            return inFlight;
        }

        const refresh = this.refreshSession(session).finally(() => {
            this._refreshInFlight.delete(session.id);
        });
        this._refreshInFlight.set(session.id, refresh);
        return refresh;
    }

    private async refreshSession(session: StoredSession): Promise<StoredSession | undefined> {
        if (!session.refreshToken) {
            await this.dropSession(session.id, false);
            return undefined;
        }

        const { clientId, clientSecret } = this.readClientConfig();
        try {
            const tokenData = await this.requestYandexToken({
                grant_type: 'refresh_token',
                refresh_token: session.refreshToken,
                client_id: clientId,
                client_secret: clientSecret
            });

            const accessToken = tokenData.access_token;
            if (!accessToken) {
                throw new Error('Yandex refresh response did not include access_token');
            }

            const next: StoredSession = {
                ...session,
                accessToken,
                refreshToken: tokenData.refresh_token || session.refreshToken,
                expiresAt: tokenData.expires_in ? Date.now() + Number(tokenData.expires_in) * 1000 : undefined
            };

            await this.storeSession(next);
            this._onDidChangeSessions.fire({
                added: [],
                removed: [],
                changed: [next]
            });
            return next;
        } catch (error) {
            console.warn('Yandex token refresh failed:', error);
            await this.dropSession(session.id, false);
            return undefined;
        }
    }

    private async dropSession(sessionId: string, notifyUser: boolean): Promise<void> {
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
            if (notifyUser) {
                vscode.window.showInformationMessage('Signed out of Yandex ID.');
            }
        }
    }

    private async requestYandexToken(params: Record<string, string>): Promise<YandexTokenResponse> {
        const tokenParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value) {
                tokenParams.set(key, value);
            }
        }

        const tokenResponse = await fetch('https://oauth.yandex.ru/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: tokenParams.toString()
        });

        if (!tokenResponse.ok) {
            const errText = await tokenResponse.text();
            throw new Error(`Yandex token request failed (${tokenResponse.status}): ${errText}`);
        }

        return tokenResponse.json() as Promise<YandexTokenResponse>;
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
        const filtered = existing.filter(s => s.account.id !== session.account.id && s.id !== session.id);
        filtered.push(session);
        await this.writeStoredSessions(filtered);
    }

    dispose() {
        this._disposable.dispose();
        this._onDidChangeSessions.dispose();
    }
}
