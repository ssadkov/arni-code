export function getWebviewContent() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
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
            Arni готов к работе через <b>OpenRouter</b> с моделью <code>Qwen 2.5 Coder 32B</code>.
        </p>
        <button id="get-free-key-btn" style="background-color: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); margin-bottom: 10px; width: 100%;" type="button">
            🔑 Получить ключ на OpenRouter (бесплатно)
        </button>
        <input type="password" id="api-key-input" placeholder="Вставьте API-ключ (sk-or-v1-...)" style="width: 100%; box-sizing: border-box; padding: 8px; margin: 6px 0 12px 0; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px;" />
        <button id="save-key-btn" style="width: 100%;" type="button">Сохранить ключ</button>
    </div>

    <div id="chat-wrapper" style="display: flex; flex-direction: column; height: 100%;">
        <div id="chat-container">
            <div class="message arni-message">Привет! Я Arni — ваш умный AI-ассистент по коду. Чем я могу помочь сегодня?</div>
        </div>
        
        <div class="input-area">
            <textarea id="message-input" rows="3" placeholder="Задайте вопрос Arni..."></textarea>
            <button id="send-btn">Отправить</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        const chatWrapper = document.getElementById('chat-wrapper');
        const setupContainer = document.getElementById('setup-container');
        const chatContainer = document.getElementById('chat-container');
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');
        const apiKeyInput = document.getElementById('api-key-input');
        const saveKeyBtn = document.getElementById('save-key-btn');
        const getFreeKeyBtn = document.getElementById('get-free-key-btn');

        if (getFreeKeyBtn) {
            getFreeKeyBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'openUrl', value: 'https://openrouter.ai/keys' });
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
                    errorMsg.textContent = 'Error: ' + message.value;
                    chatContainer.appendChild(errorMsg);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                    currentArniMessage = null;
                    break;
                case 'clearChat':
                    chatContainer.innerHTML = '<div class="message arni-message">Hello! I am Arni, your intelligent coding assistant. How can I help you today?</div>';
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
