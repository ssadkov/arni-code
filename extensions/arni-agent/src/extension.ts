import * as vscode from 'vscode';
import { ChatPanelProvider } from './webview/chatPanel';

export function activate(context: vscode.ExtensionContext) {
    const chatPanelProvider = new ChatPanelProvider(context.extensionUri, context.secrets);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'arni.chatView',
            chatPanelProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('arni.openAgent', () => {
            vscode.commands.executeCommand('arni.chatView.focus');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('arni.newChat', () => {
            chatPanelProvider.clearChat();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('arni.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'arni');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('arni.setApiKey', async () => {
            const key = await vscode.window.showInputBox({
                title: 'Arni: Set API Key',
                prompt: 'Enter your API key for Arni (saved securely in OS SecretStorage)',
                password: true,
                ignoreFocusOut: true
            });
            if (key !== undefined) {
                if (key.trim().length > 0) {
                    await context.secrets.store('arni.apiKey', key.trim());
                    vscode.window.showInformationMessage('Arni API key stored securely.');
                } else {
                    await context.secrets.delete('arni.apiKey');
                    vscode.window.showInformationMessage('Arni API key removed.');
                }
            }
        })
    );
}

export function deactivate() {}
