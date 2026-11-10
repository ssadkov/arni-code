import * as vscode from 'vscode';
import { GoogleAuthenticationProvider, GOOGLE_PROVIDER_ID } from './googleAuthProvider';

export function activate(context: vscode.ExtensionContext) {
    const provider = new GoogleAuthenticationProvider(context);
    context.subscriptions.push(provider);

    context.subscriptions.push(
        vscode.commands.registerCommand('google.signIn', async () => {
            try {
                return await vscode.authentication.getSession(GOOGLE_PROVIDER_ID, [], { createIfNone: true });
            } catch (err: any) {
                vscode.window.showErrorMessage(`Ошибка входа через Google: ${err.message}`);
                return undefined;
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('google.signOut', async () => {
            const sessions = await provider.getSessions();
            if (sessions.length === 0) {
                vscode.window.showInformationMessage('Вы не вошли через Google.');
                return;
            }
            for (const session of sessions) {
                await provider.removeSession(session.id);
            }
        })
    );
}

export function deactivate() { }
