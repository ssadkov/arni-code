import * as vscode from 'vscode';
import { ArniProvider } from './arniProvider';

export interface AIProvider {
    chat(message: string, onProgress: (chunk: string) => void): Promise<void>;
}

export class ProviderFactory {
    static create(providerName: string, apiKey: string, config: vscode.WorkspaceConfiguration): AIProvider {
        let baseUrl = config.get<string>('apiBaseUrl') || '';
        const modelId = config.get<string>('modelId') || '';
        const enableStreaming = config.get<boolean>('enableStreaming') ?? true;
        
        if (!baseUrl) {
            switch (providerName) {
                case 'openai': baseUrl = 'https://api.openai.com/v1'; break;
                case 'deepseek': baseUrl = 'https://api.deepseek.com/v1'; break;
                case 'ollama': baseUrl = 'http://localhost:11434/v1'; break;
                case 'openrouter': baseUrl = 'https://openrouter.ai/api/v1'; break;
                case 'arni': default: baseUrl = 'https://api.arni.ai/v1'; break;
            }
        }

        return new ArniProvider(apiKey, baseUrl, modelId, enableStreaming);
    }
}
