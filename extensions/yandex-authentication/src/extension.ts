import * as vscode from 'vscode';
import { YandexAuthenticationProvider } from './yandexAuthProvider';

export function activate(context: vscode.ExtensionContext) {
    const provider = new YandexAuthenticationProvider(context);
    context.subscriptions.push(provider);

    context.subscriptions.push(
        vscode.commands.registerCommand('yandex.signIn', async () => {
            try {
                const session = await vscode.authentication.getSession('yandex', ['login:info', 'login:email'], { createIfNone: true });
                if (session) {
                    vscode.window.showInformationMessage(`Авторизован в Яндекс ID: ${session.account.label}`);
                }
                return session;
            } catch (err: any) {
                vscode.window.showErrorMessage(`Ошибка авторизации Яндекс ID: ${err.message}`);
                return undefined;
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('yandex.signOut', async () => {
            try {
                const session = await vscode.authentication.getSession('yandex', [], { createIfNone: false });
                if (session) {
                    await provider.removeSession(session.id);
                } else {
                    vscode.window.showInformationMessage('Вы не авторизованы в Яндекс ID.');
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`Ошибка: ${err.message}`);
            }
        })
    );
}

export function deactivate() {}
