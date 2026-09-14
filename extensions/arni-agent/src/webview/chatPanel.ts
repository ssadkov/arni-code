import * as vscode from 'vscode';
import { getWebviewContent } from './getWebviewContent';
import { ArniProvider } from '../providers/arniProvider';
import { readArniJwtFromExchangeBody, resolveArniApiBaseUrl, resolveArniAuthExchangeUrl } from '../arniBackend';

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

        webviewView.webview.html = getWebviewContent();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    await this.handleMessage(data.value);
                    break;
                case 'checkApiKey':
                    // Just tell the UI it's OK, we handle auth silently via Yandex now
                    this._view?.webview.postMessage({ type: 'apiKeySaved' });
                    break;
                case 'openUrl':
                    if (data.value) {
                        vscode.env.openExternal(vscode.Uri.parse(data.value));
                    }
                    break;
            }
        });
    }

    public clearChat() {
        this._view?.webview.postMessage({ type: 'clearChat' });
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

        const cachedJwt = await this._secrets.get('arni.jwtToken');
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
                await this._secrets.store('arni.jwtToken', arniJwt);
                return arniJwt;
            }
        } catch (error) {
            console.error('Token exchange failed:', error);
            throw new Error('Could not authorize with the Arni backend.');
        }

        return undefined;
    }

    private async handleMessage(message: string) {
        if (!this._view) { return; }

        let arniToken: string | undefined;
        try {
            arniToken = await this.getArniToken();
        } catch (e: any) {
            this._view.webview.postMessage({ type: 'error', value: e.message });
            return;
        }

        if (!arniToken) {
            this._view.webview.postMessage({ type: 'error', value: 'Sign in with Yandex ID to use Arni.' });
            return;
        }

        try {
            const config = vscode.workspace.getConfiguration('arni');
            const apiBase = resolveArniApiBaseUrl(config.get<string>('backendUrl'));
            const provider = new ArniProvider(arniToken, apiBase, 'openrouter/auto', true);
            
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
                this._view.webview.postMessage({ type: 'error', value: 'Session expired. Send the message again to re-authorize.' });
            } else if (error.message?.includes('402')) {
                this._view.webview.postMessage({ type: 'error', value: 'Your token balance is empty. Open settings to top up.' });
            } else {
                this._view.webview.postMessage({ 
                    type: 'error', 
                    value: error.message || 'Could not reach the Arni backend.'
                });
            }
        }
    }
}
