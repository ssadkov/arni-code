import { AIProvider } from './providerFactory';

export class ArniProvider implements AIProvider {
    constructor(
        private apiKey: string,
        private baseUrl: string,
        private modelId: string,
        private enableStreaming: boolean
    ) {}

    async chat(message: string, onProgress: (chunk: string) => void): Promise<void> {
        try {
            const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
            const model = this.modelId || 'default-model';

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: message }],
                    stream: this.enableStreaming
                })
            });

            if (!response.ok) {
                throw new Error(`API returned ${response.status}: ${response.statusText}`);
            }

            if (!this.enableStreaming) {
                const data: any = await response.json();
                onProgress(data.choices?.[0]?.message?.content || '');
                return;
            }

            if (!response.body) {
                throw new Error('ReadableStream not supported by this API response.');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.trim() !== '');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6);
                        if (dataStr === '[DONE]') continue;
                        
                        try {
                            const parsed = JSON.parse(dataStr);
                            const content = parsed.choices?.[0]?.delta?.content;
                            if (content) {
                                onProgress(content);
                            }
                        } catch (e) {
                            // Ignore parse errors for incomplete chunks
                        }
                    }
                }
            }
        } catch (error: any) {
            console.error("ArniProvider Error:", error);
            throw error;
        }
    }
}
