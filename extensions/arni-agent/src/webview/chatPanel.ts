/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { getWebviewContent } from './getWebviewContent';
import { ArniProvider } from '../providers/arniProvider';

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
                    void this.refreshFreeSteps();
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
        // 1. Проверяем, есть ли уже токен от бэкенда
        let arniJwt = await this._secrets.get('arni.jwtToken');
        if (arniJwt) return arniJwt;

        // 2. Получаем сессию Яндекса (через системный провайдер, который мы починили)
        let session = await vscode.authentication.getSession('yandex', [], { createIfNone: false });
        if (!session) {
            try {
                session = await vscode.authentication.getSession('yandex', [], { createIfNone: true });
            } catch (e) {
                return undefined;
            }
        }
        if (!session) return undefined;

        // 3. Обмениваем токен Яндекса на универсальный JWT нашего бэкенда
        const config = vscode.workspace.getConfiguration('arni');
        const backendUrl = config.get<string>('backendUrl') || 'https://api.arnion.ru';
        
        try {
            const response = await fetch(`${backendUrl}/api/auth/exchange`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: 'yandex', token: session.accessToken })
            });

            if (!response.ok) {
                throw new Error(`Failed to exchange token: ${await response.text()}`);
            }

            const data: any = await response.json();
            arniJwt = data.token;
            if (arniJwt) {
                await this._secrets.store('arni.jwtToken', arniJwt);
                return arniJwt;
            }
        } catch (error) {
            console.error('Token exchange failed:', error);
            throw new Error('Не удалось авторизоваться на сервере Arni.');
        }

        return undefined;
    }

    private async refreshFreeSteps(): Promise<void> {
        if (!this._view) {
            return;
        }
        try {
            let token = await this._secrets.get('arni.jwtToken');
            if (!token) {
                const session = await vscode.authentication.getSession('yandex', [], { createIfNone: false });
                if (!session) {
                    return;
                }
                token = await this.getArniToken();
            }
            if (!token) {
                return;
            }
            const config = vscode.workspace.getConfiguration('arni');
            const backendUrl = (config.get<string>('backendUrl') || 'https://api.arnion.ru').replace(/\/+$/, '').replace(/\/api$/i, '');
            const response = await fetch(`${backendUrl}/api/account`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!response.ok) {
                return;
            }
            const data = await response.json() as { user?: { freeSteps?: { used: number; limit: number; remaining: number; resetsAt: string; total: number }; budget?: {
                enabled: boolean; expired: boolean; balanceMicros: number; validUntil: string;
                fiveHour: { usedMicros: number; limitMicros: number; requests: number; requestLimit: number; resetsAt: string | null };
                weekly: { usedMicros: number; limitMicros: number; requests: number; requestLimit: number; resetsAt: string | null };
            } } };
            if (data.user?.budget) {
                const budget = data.user.budget;
                const money = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
                const available = Math.max(0, Math.min(budget.balanceMicros, budget.fiveHour.limitMicros - budget.fiveHour.usedMicros, budget.weekly.limitMicros - budget.weekly.usedMicros));
                this._view.webview.postMessage({ type: 'budget', value: {
                    text: !budget.enabled || budget.expired ? vscode.l10n.t('Доступ приостановлен или истёк') : vscode.l10n.t('Доступно API: {0}', money(available)),
                    tooltip: vscode.l10n.t('Бюджет {0}. За 5 часов: {1}/{2} запросов. За неделю: {3}/{4} запросов. Доступ до {5}.', money(budget.balanceMicros), budget.fiveHour.requests, budget.fiveHour.requestLimit, budget.weekly.requests, budget.weekly.requestLimit, new Date(budget.validUntil).toLocaleString()),
                } });
            } else if (data.user?.freeSteps) {
                this._view.webview.postMessage({ type: 'freeSteps', value: data.user.freeSteps });
            }
        } catch (error) {
            console.error('Failed to load free steps:', error);
        }
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
            this._view.webview.postMessage({ type: 'error', value: 'Для использования ИИ необходимо войти через Яндекс.' });
            return;
        }

        try {
            const config = vscode.workspace.getConfiguration('arni');
            const backendUrl = config.get<string>('backendUrl') || 'https://api.arnion.ru';
            
            // Используем наш прокси-провайдер с JWT токеном
            const provider = new ArniProvider(arniToken, backendUrl, 'openrouter/auto', true);
            
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
            void this.refreshFreeSteps();
        } catch (error: any) {
            if (error.message?.includes('401')) {
                // Если JWT протух, удаляем его, чтобы при следующем запросе получить новый
                await this._secrets.delete('arni.jwtToken');
                this._view.webview.postMessage({ type: 'error', value: 'Сессия устарела. Пожалуйста, отправьте сообщение еще раз для переавторизации.' });
            } else if (error.message?.includes('402')) {
                this._view.webview.postMessage({ type: 'error', value: 'На вашем балансе закончились токены. Перейдите в настройки для пополнения.' });
            } else if (error.message?.includes('429')) {
                void this.refreshFreeSteps();
                this._view.webview.postMessage({ type: 'error', value: 'Дневной лимит бесплатных шагов исчерпан.' });
            } else {
                this._view.webview.postMessage({ 
                    type: 'error', 
                    value: error.message || 'Ошибка связи с сервером.'
                });
            }
        }
    }
}
