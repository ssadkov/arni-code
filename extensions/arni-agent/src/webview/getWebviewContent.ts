export interface ArniWebviewContentOptions {
    language?: string;
}

export const ARNI_GREETING_RU = 'Привет! Я Arni — ваш умный AI-ассистент по коду. Чем я могу помочь сегодня?';
export const ARNI_GREETING_EN = 'Hello! I am Arni, your intelligent coding assistant. How can I help you today?';

export function isRussianLocale(language?: string): boolean {
    if (!language || language.trim().length === 0) {
        return true;
    }
    return language.toLowerCase().startsWith('ru');
}

export function getArniGreeting(language?: string): string {
    return isRussianLocale(language) ? ARNI_GREETING_RU : ARNI_GREETING_EN;
}

function getNonce(): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return nonce;
}

export function getWebviewContent(options: ArniWebviewContentOptions = {}) {
    const nonce = getNonce();
    const language = options.language ?? 'ru';
    const htmlLang = isRussianLocale(language) ? 'ru' : 'en';
    const greeting = getArniGreeting(language);
    const csp = `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;

    return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Arni Agent</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        .header {
            padding: 10px;
            background-color: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
            font-weight: bold;
            text-align: center;
        }
        #chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .message {
            padding: 10px;
            border-radius: 6px;
            max-width: 90%;
            word-wrap: break-word;
        }
        .user-message {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            align-self: flex-end;
        }
        .arni-message {
            background-color: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-widget-border);
            align-self: flex-start;
            line-height: 1.5;
        }
        .input-area {
            padding: 10px;
            background-color: var(--vscode-sideBar-background);
            border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        textarea {
            width: 100%;
            box-sizing: border-box;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 8px;
            border-radius: 4px;
            resize: none;
            font-family: inherit;
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        #setup-container {
            display: none;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            padding: 20px;
            text-align: center;
        }
        pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
        }
        code {
            font-family: var(--vscode-editor-font-family);
        }
    </style>
</head>
<body>
    <div class="header">Arni Agent</div>
    
    <div id="setup-container">
        <h2>Добро пожаловать в Arni!</h2>
        <p style="font-size: 13px; color: var(--vscode-descriptionForeground); margin-bottom: 14px;">
            Войдите через Яндекс ID или вставьте ключ OpenRouter. Модель по умолчанию: <code>Qwen 2.5 Coder 32B</code>.
        </p>
        <button id="yandex-signin-btn" style="width: 100%; margin-bottom: 10px;" type="button">
            Войти через Яндекс ID
        </button>
        <button id="get-free-key-btn" style="background-color: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); margin-bottom: 10px; width: 100%;" type="button">
            🔑 Получить ключ на OpenRouter (бесплатно)
        </button>
        <input type="password" id="api-key-input" placeholder="Вставьте API-ключ (sk-or-v1-...)" style="width: 100%; box-sizing: border-box; padding: 8px; margin: 6px 0 12px 0; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px;" />
        <button id="save-key-btn" style="width: 100%;" type="button">Сохранить ключ</button>
    </div>

    <div id="chat-wrapper" style="display: flex; flex-direction: column; height: 100%;">
        <div id="chat-container">
            <div class="message arni-message">${escapeHtml(greeting)}</div>
        </div>
        
        <div class="input-area">
            <textarea id="message-input" rows="3" placeholder="Задайте вопрос Arni..."></textarea>
            <button id="send-btn">Отправить</button>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const ARNI_GREETING = ${JSON.stringify(greeting)};
        
        const chatWrapper = document.getElementById('chat-wrapper');
        const setupContainer = document.getElementById('setup-container');
        const chatContainer = document.getElementById('chat-container');
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');
        const apiKeyInput = document.getElementById('api-key-input');
        const saveKeyBtn = document.getElementById('save-key-btn');
        const getFreeKeyBtn = document.getElementById('get-free-key-btn');
        const yandexSignInBtn = document.getElementById('yandex-signin-btn');

        if (getFreeKeyBtn) {
            getFreeKeyBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'openUrl', value: 'https://openrouter.ai/keys' });
            });
        }

        if (yandexSignInBtn) {
            yandexSignInBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'signInYandex' });
            });
        }

        let currentArniMessage = null;

        vscode.postMessage({ type: 'checkApiKey' });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'requestApiKey':
                    chatWrapper.style.display = 'none';
                    setupContainer.style.display = 'flex';
                    break;
                case 'apiKeySaved':
                    setupContainer.style.display = 'none';
                    chatWrapper.style.display = 'flex';
                    break;
                case 'streamResponse':
                    if (!currentArniMessage) {
                        currentArniMessage = document.createElement('div');
                        currentArniMessage.className = 'message arni-message';
                        chatContainer.appendChild(currentArniMessage);
                    }
                    currentArniMessage.textContent = message.value;
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                    if (message.done) {
                        currentArniMessage = null;
                    }
                    break;
                case 'error':
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'message arni-message';
                    errorMsg.style.color = 'var(--vscode-errorForeground)';
                    errorMsg.textContent = 'Ошибка: ' + message.value;
                    chatContainer.appendChild(errorMsg);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                    currentArniMessage = null;
                    break;
                case 'clearChat':
                    chatContainer.replaceChildren();
                    const hello = document.createElement('div');
                    hello.className = 'message arni-message';
                    hello.textContent = ARNI_GREETING;
                    chatContainer.appendChild(hello);
                    currentArniMessage = null;
                    break;
            }
        });

        saveKeyBtn.addEventListener('click', () => {
            const key = apiKeyInput.value.trim();
            if (key) {
                vscode.postMessage({ type: 'saveApiKey', value: key });
                apiKeyInput.value = '';
            }
        });

        sendBtn.addEventListener('click', sendMessage);
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        function sendMessage() {
            const text = messageInput.value.trim();
            if (text) {
                const userMsg = document.createElement('div');
                userMsg.className = 'message user-message';
                userMsg.textContent = text;
                chatContainer.appendChild(userMsg);
                chatContainer.scrollTop = chatContainer.scrollHeight;
                
                vscode.postMessage({ type: 'sendMessage', value: text });
                messageInput.value = '';
            }
        }
    </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
