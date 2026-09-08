import * as vscode from 'vscode';
import { getWebviewContent } from './getWebviewContent';
import { ProviderFactory } from '../providers/providerFactory';

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
                case 'saveApiKey':
                    await this._secrets.store('arni.apiKey', data.value);
                    vscode.window.showInformationMessage('Arni API key saved successfully.');
                    this._view?.webview.postMessage({ type: 'apiKeySaved' });
                    break;
                case 'checkApiKey':
                    const apiKey = await this._secrets.get('arni.apiKey');
                    if (apiKey) {
                        this._view?.webview.postMessage({ type: 'apiKeySaved' });
                    } else {
                        this._view?.webview.postMessage({ type: 'requestApiKey' });
                    }
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

    private async handleMessage(message: string) {
        if (!this._view) { return; }

        const apiKey = await this._secrets.get('arni.apiKey');
        if (!apiKey) {
            this._view.webview.postMessage({ type: 'requestApiKey' });
            return;
        }

        try {
            const config = vscode.workspace.getConfiguration('arni');
            const providerName = config.get<string>('provider') || 'arni';
            
            const provider = ProviderFactory.create(providerName, apiKey, config);
            
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
            this._view.webview.postMessage({ 
                type: 'error', 
                value: error.message || 'An error occurred during communication.'
            });
        }
    }
}
