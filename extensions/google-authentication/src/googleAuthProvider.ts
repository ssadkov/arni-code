import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import { LoopbackServer } from './loopbackServer';

export const GOOGLE_PROVIDER_ID = 'google';

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

interface GoogleTokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
}

const SESSIONS_SECRET_KEY = 'google.auth.sessions';
const SCOPES = ['openid', 'email', 'profile'];

// Desktop app OAuth client of the Arni Google Cloud project. Google issues a
// secret to installed-app clients too and documents that it is not
// confidential; PKCE protects the code exchange.
const DEFAULT_CLIENT_ID = '';
const DEFAULT_CLIENT_SECRET = '';

// Refresh a little before Google's one-hour expiry so a request that starts
// now does not carry a token that dies on the way.
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

export class GoogleAuthenticationProvider implements vscode.AuthenticationProvider, vscode.Disposable {
    private readonly _onDidChangeSessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
    readonly onDidChangeSessions = this._onDidChangeSessions.event;

    private readonly _disposable: vscode.Disposable;
    private _refreshing: Promise<StoredSession[]> | undefined;

    constructor(private readonly context: vscode.ExtensionContext) {
        this._disposable = vscode.authentication.registerAuthenticationProvider(
            GOOGLE_PROVIDER_ID,
            'Google',
            this,
            { supportsMultipleAccounts: false }
        );
    }

    async getSessions(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
        const stored = await this.freshSessions();
        if (!scopes || scopes.length === 0) {
            return stored;
        }
        return stored.filter(s => scopes.every(scope => s.scopes.includes(scope)));
    }

    async createSession(_scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
        const { clientId, clientSecret } = this.clientCredentials();

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

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', SCOPES.join(' '));
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        // Offline access returns a refresh token, so the session outlives the
        // one-hour access token. Google returns it only on consent.
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent select_account');

        await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

        let authCode: string;
        try {
            authCode = (await loopback.waitForCode(state)).code;
        } catch (error) {
            loopback.stop();
            throw error;
        }

        const tokenData = await this.requestToken({
            grant_type: 'authorization_code',
            code: authCode,
            client_id: clientId,
            client_secret: clientSecret,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri,
        });
        if (!tokenData.access_token) {
            throw new Error(`Google не выдал токен: ${tokenData.error_description || tokenData.error || 'нет access_token'}`);
        }

        const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        if (!profileResponse.ok) {
            throw new Error(`Не удалось получить профиль Google: ${profileResponse.statusText}`);
        }
        const profile = await profileResponse.json() as { sub?: string; name?: string; email?: string };
        const displayName = profile.name || profile.email || 'Пользователь Google';
        const accountLabel = profile.email && profile.email !== displayName ? `${displayName} (${profile.email})` : displayName;

        const session: StoredSession = {
            id: crypto.randomUUID(),
            account: { id: profile.sub || crypto.randomUUID(), label: accountLabel },
            scopes: SCOPES,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
        };

        const existing = await this.readStoredSessions();
        await this.writeStoredSessions([...existing.filter(s => s.account.id !== session.account.id), session]);
        this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });

        vscode.window.showInformationMessage(`Вы вошли через Google: ${accountLabel}`);
        return session;
    }

    async removeSession(sessionId: string): Promise<void> {
        const stored = await this.readStoredSessions();
        const removed = stored.filter(s => s.id === sessionId);
        if (removed.length === 0) {
            return;
        }
        await this.writeStoredSessions(stored.filter(s => s.id !== sessionId));
        this._onDidChangeSessions.fire({ added: [], removed, changed: [] });
        vscode.window.showInformationMessage('Вы вышли из аккаунта Google.');
    }

    /**
     * Returns the stored sessions with expired access tokens refreshed.
     * A session whose refresh token Google rejects is dropped, which shows
     * the user as signed out instead of failing every request.
     */
    private freshSessions(): Promise<StoredSession[]> {
        if (!this._refreshing) {
            this._refreshing = this.refreshExpired().finally(() => this._refreshing = undefined);
        }
        return this._refreshing;
    }

    private async refreshExpired(): Promise<StoredSession[]> {
        const stored = await this.readStoredSessions();
        const now = Date.now();
        if (!stored.some(s => s.expiresAt !== undefined && s.expiresAt - REFRESH_MARGIN_MS <= now)) {
            return stored;
        }

        const kept: StoredSession[] = [];
        const changed: StoredSession[] = [];
        const removed: StoredSession[] = [];
        for (const session of stored) {
            if (session.expiresAt === undefined || session.expiresAt - REFRESH_MARGIN_MS > now) {
                kept.push(session);
                continue;
            }
            if (!session.refreshToken) {
                removed.push(session);
                continue;
            }
            let tokenData: GoogleTokenResponse;
            try {
                const { clientId, clientSecret } = this.clientCredentials();
                tokenData = await this.requestToken({
                    grant_type: 'refresh_token',
                    refresh_token: session.refreshToken,
                    client_id: clientId,
                    client_secret: clientSecret,
                });
            } catch {
                // Offline or Google unreachable: keep the session and try again later.
                kept.push(session);
                continue;
            }
            if (!tokenData.access_token) {
                removed.push(session);
                continue;
            }
            const updated: StoredSession = {
                ...session,
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token || session.refreshToken,
                expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
            };
            kept.push(updated);
            changed.push(updated);
        }

        if (changed.length > 0 || removed.length > 0) {
            await this.writeStoredSessions(kept);
            this._onDidChangeSessions.fire({ added: [], removed, changed });
        }
        return kept;
    }

    /** Posts to Google's token endpoint. Throws only when the request itself fails. */
    private async requestToken(params: Record<string, string>): Promise<GoogleTokenResponse> {
        const body = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value) {
                body.set(key, value);
            }
        }
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        const data = await response.json().catch(() => ({})) as GoogleTokenResponse;
        if (!response.ok && !data.error) {
            throw new Error(`Google token endpoint returned ${response.status}`);
        }
        return data;
    }

    private clientCredentials(): { clientId: string; clientSecret: string } {
        const config = vscode.workspace.getConfiguration('google');
        const clientId = config.get<string>('clientId')?.trim() || DEFAULT_CLIENT_ID;
        const clientSecret = config.get<string>('clientSecret')?.trim() || DEFAULT_CLIENT_SECRET;
        if (!clientId) {
            throw new Error('Вход через Google не настроен в этой сборке.');
        }
        return { clientId, clientSecret };
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

    dispose() {
        this._disposable.dispose();
        this._onDidChangeSessions.dispose();
    }
}
