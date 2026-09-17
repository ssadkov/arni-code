import * as vscode from 'vscode';
import { getWebviewContent } from './getWebviewContent';
import { ArniProvider } from '../providers/arniProvider';
import { readArniJwtFromExchangeBody, readCachedArniJwt, resolveArniAuthExchangeUrl, resolveSidebarChatRequest, serializeCachedArniJwt } from '../arniBackend';

export class ChatPanelProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _secrets: vscode.SecretStorage
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = getWebviewContent({ language: vscode.env.language });

        const subscriptions: vscode.Disposable[] = [];
        webviewView.onDidDispose(() => {
            for (const sub of subscriptions) {
                sub.dispose();
            }
        });

        subscriptions.push(webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    await this.handleMessage(data.value);
                    break;
                case 'checkApiKey':
                    await this.postReadyState();
                    break;
                case 'saveApiKey':
                    await this.saveApiKey(data.value);
                    break;
                case 'signInYandex':
                    await this.signInYandexFromWebview();
                    break;
                case 'openUrl':
                    if (data.value) {
                        vscode.env.openExternal(vscode.Uri.parse(data.value));
                    }
                    break;
            }
        }));

        subscriptions.push(this._secrets.onDidChange(async (e) => {
            if (e.key === 'arni.apiKey' || e.key === 'arni.jwtToken') {
                await this.postReadyState();
            }
        }));

        subscriptions.push(vscode.authentication.onDidChangeSessions(async (e) => {
            if (e.provider.id === 'yandex') {
                await this.postReadyState();
            }
        }));
    }

    public clearChat() {
        this._view?.webview.postMessage({ type: 'clearChat' });
    }

    private async hasStoredApiKey(): Promise<boolean> {
        const key = await this._secrets.get('arni.apiKey');
        return !!key && key.trim().length > 0;
    }

    private async hasYandexSession(): Promise<boolean> {
        const session = await vscode.authentication.getSession('yandex', [], { createIfNone: false });
        return !!session;
    }

    private async postReadyState(): Promise<void> {
        const ready = await this.hasYandexSession() || await this.hasStoredApiKey();
        this._view?.webview.postMessage({ type: ready ? 'apiKeySaved' : 'requestApiKey' });
    }

    private async saveApiKey(value: unknown): Promise<void> {
        const key = typeof value === 'string' ? value.trim() : '';
        if (!key) {
            this._view?.webview.postMessage({ type: 'error', value: 'Введите API-ключ.' });
            return;
        }
        await this._secrets.store('arni.apiKey', key);
        this._view?.webview.postMessage({ type: 'apiKeySaved' });
    }

    private async signInYandexFromWebview(): Promise<void> {
        try {
            const token = await this.getArniToken();
            if (token) {
                this._view?.webview.postMessage({ type: 'apiKeySaved' });
            } else {
                this._view?.webview.postMessage({ type: 'requestApiKey' });
            }
        } catch (e: any) {
            this._view?.webview.postMessage({ type: 'error', value: e.message || 'Не удалось войти через Яндекс ID.' });
            this._view?.webview.postMessage({ type: 'requestApiKey' });
        }
    }

    private async getArniToken(): Promise<string | undefined> {
        let session = await vscode.authentication.getSession('yandex', [], { createIfNone: false });
        if (!session) {
            await this._secrets.delete('arni.jwtToken');
            try {
                session = await vscode.authentication.getSession('yandex', [], { createIfNone: true });
            } catch {
                return undefined;
            }
        }
        if (!session) {
            await this._secrets.delete('arni.jwtToken');
            return undefined;
        }

        const cachedJwt = readCachedArniJwt(await this._secrets.get('arni.jwtToken'));
        if (cachedJwt) {
            return cachedJwt;
        }

        const config = vscode.workspace.getConfiguration('arni');
        const backendUrl = config.get<string>('backendUrl');

        try {
            const response = await fetch(resolveArniAuthExchangeUrl(backendUrl), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: 'yandex', token: session.accessToken })
            });

            if (!response.ok) {
                throw new Error(`Failed to exchange token: ${await response.text()}`);
            }

            const data: any = await response.json();
            const arniJwt = readArniJwtFromExchangeBody(data);
            if (arniJwt) {
                await this._secrets.store('arni.jwtToken', serializeCachedArniJwt(arniJwt));
                return arniJwt;
            }
        } catch (error) {
            console.error('Token exchange failed:', error);
            throw new Error('Не удалось авторизоваться на бэкенде Arni.');
        }

        return undefined;
    }

    private readChatSettings() {
        const config = vscode.workspace.getConfiguration('arni');
        return {
            provider: config.get<string>('provider'),
            apiBaseUrl: config.get<string>('apiBaseUrl'),
            backendUrl: config.get<string>('backendUrl'),
            modelId: config.get<string>('modelId'),
            enableStreaming: config.get<boolean>('enableStreaming') ?? true
        };
    }

    private async handleMessage(message: string) {
        if (!this._view) { return; }

        const hasYandexSession = await this.hasYandexSession();
        const storedApiKey = await this._secrets.get('arni.apiKey');
        const hasApiKey = !!storedApiKey && storedApiKey.trim().length > 0;
        const target = resolveSidebarChatRequest({
            ...this.readChatSettings(),
            hasYandexSession,
            hasApiKey
        });

        let apiKey: string | undefined;
        try {
            if (target.useJwt) {
                apiKey = await this.getArniToken();
            } else {
                apiKey = storedApiKey?.trim();
            }
        } catch (e: any) {
            this._view.webview.postMessage({ type: 'error', value: e.message });
            return;
        }

        if (!apiKey) {
            this._view.webview.postMessage({ type: 'error', value: 'Войдите через Яндекс ID или сохраните API-ключ, чтобы пользоваться Arni.' });
            await this.postReadyState();
            return;
        }

        try {
            const provider = new ArniProvider(apiKey, target.baseUrl, target.modelId, target.enableStreaming);

            let fullResponse = '';
            await provider.chat(message, (chunk: string) => {
                fullResponse += chunk;
                this._view?.webview.postMessage({
                    type: 'streamResponse',
                    value: fullResponse,
                    done: false
                });
            });

            this._view.webview.postMessage({
                type: 'streamResponse',
                value: fullResponse,
                done: true
            });
        } catch (error: any) {
            if (error.message?.includes('401')) {
                await this._secrets.delete('arni.jwtToken');
                this._view.webview.postMessage({ type: 'error', value: 'Сессия истекла. Отправьте сообщение ещё раз, чтобы войти заново.' });
            } else if (error.message?.includes('402')) {
                this._view.webview.postMessage({ type: 'error', value: 'Баланс токенов пуст. Откройте настройки, чтобы пополнить.' });
            } else {
                this._view.webview.postMessage({
                    type: 'error',
                    value: error.message || 'Не удалось связаться с бэкендом Arni.'
                });
            }
        }
    }
}
