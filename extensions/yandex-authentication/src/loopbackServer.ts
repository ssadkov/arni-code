import * as http from 'node:http';
import * as url from 'node:url';

export interface LoopbackResult {
    code: string;
}

export class LoopbackServer {
    private server?: http.Server;
    private port: number = 0;

    async start(): Promise<number> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer();
            
            this.server.on('error', (err) => {
                reject(err);
            });

            // Listen on 127.0.0.1 on random available port
            this.server.listen(0, '127.0.0.1', () => {
                const addr = this.server?.address();
                if (addr && typeof addr === 'object') {
                    this.port = addr.port;
                    resolve(this.port);
                } else {
                    reject(new Error('Failed to obtain loopback server port'));
                }
            });
        });
    }

    async waitForCode(expectedState: string, timeoutMs: number = 300000): Promise<LoopbackResult> {
        if (!this.server) {
            throw new Error('Server not started');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.stop();
                reject(new Error('Время ожидания авторизации истекло (Timeout)'));
            }, timeoutMs);

            this.server?.on('request', (req, res) => {
                const reqUrl = url.parse(req.url || '', true);
                if (reqUrl.pathname !== '/callback') {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('Not found');
                    return;
                }

                const query = reqUrl.query;
                const state = query.state as string;
                const code = query.code as string;
                const error = query.error as string;
                const errorDesc = (query.error_description as string) || error;

                if (error) {
                    clearTimeout(timeout);
                    this.sendErrorResponse(res, errorDesc);
                    setTimeout(() => this.stop(), 500);
                    reject(new Error(`Ошибка авторизации Яндекс: ${errorDesc}`));
                    return;
                }

                if (state !== expectedState) {
                    this.sendErrorResponse(res, 'Неверный параметр безопасности state (CSRF verification failed)');
                    return;
                }

                if (!code) {
                    this.sendErrorResponse(res, 'Код авторизации не получен');
                    return;
                }

                clearTimeout(timeout);
                this.sendSuccessResponse(res);
                setTimeout(() => this.stop(), 500);
                resolve({ code });
            });
        });
    }

    private sendSuccessResponse(res: http.ServerResponse) {
        const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Arni Code — Авторизация Яндекс ID</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #1e1e1e;
      color: #f0f0f0;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: #252526;
      border: 1px solid #3c3c3c;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      text-align: center;
      max-width: 440px;
    }
    .icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 22px;
      margin: 0 0 12px;
      color: #FC3F1D;
    }
    p {
      font-size: 14px;
      color: #cccccc;
      line-height: 1.6;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Вход в Яндекс ID выполнен!</h1>
    <p>Авторизация в Arni Code прошла успешно.<br>Теперь вы можете закрыть эту страницу и вернуться в редактор.</p>
  </div>
</body>
</html>`;

        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': Buffer.byteLength(html, 'utf-8'),
        });
        res.end(html);
    }

    private sendErrorResponse(res: http.ServerResponse, message: string) {
        const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Arni Code — Ошибка авторизации</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #1e1e1e;
      color: #f0f0f0;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: #252526;
      border: 1px solid #f44336;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      text-align: center;
      max-width: 440px;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; margin: 0 0 12px; color: #f44336; }
    p { font-size: 14px; color: #cccccc; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>Ошибка авторизации</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;

        res.writeHead(400, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': Buffer.byteLength(html, 'utf-8'),
        });
        res.end(html);
    }

    stop() {
        if (this.server) {
            try {
                this.server.close();
            } catch (e) {
                // ignore
            }
            this.server = undefined;
        }
    }
}
