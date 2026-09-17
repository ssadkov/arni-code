import * as vscode from 'vscode';
import { ArniProvider } from './arniProvider';
import { resolveProviderBaseUrl } from '../arniBackend';

export interface AIProvider {
    chat(message: string, onProgress: (chunk: string) => void): Promise<void>;
}

export class ProviderFactory {
    static create(providerName: string, apiKey: string, config: vscode.WorkspaceConfiguration): AIProvider {
        const baseUrl = resolveProviderBaseUrl(
            providerName,
            config.get<string>('apiBaseUrl'),
            config.get<string>('backendUrl')
        );
        const modelId = config.get<string>('modelId') || '';
        const enableStreaming = config.get<boolean>('enableStreaming') ?? true;

        return new ArniProvider(apiKey, baseUrl, modelId, enableStreaming);
    }
}
