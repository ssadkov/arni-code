import * as vscode from 'vscode';
import { VkAuthenticationProvider } from './vkAuthProvider';

export function activate(context: vscode.ExtensionContext) {
    const provider = new VkAuthenticationProvider(context);
    context.subscriptions.push(provider);

    context.subscriptions.push(
        vscode.commands.registerCommand('vk.signIn', async () => {
            try {
                const session = await vscode.authentication.getSession('vk', ['vkid.personal_info', 'email'], { createIfNone: true });
                if (session) {
                    vscode.window.showInformationMessage(`Авторизован через VK: ${session.account.label}`);
                }
                return session;
            } catch (err: any) {
                vscode.window.showErrorMessage(`Ошибка авторизации VK: ${err.message}`);
                return undefined;
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vk.signOut', async () => {
            try {
                const session = await vscode.authentication.getSession('vk', [], { createIfNone: false });
                if (session) {
                    await provider.removeSession(session.id);
                } else {
                    vscode.window.showInformationMessage('Вы не авторизованы через VK.');
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`Ошибка: ${err.message}`);
            }
        })
    );
}

export function deactivate() { }
