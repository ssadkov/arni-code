import * as http from 'node:http';

export interface LoopbackResult {
    code: string;
}

interface PendingCallback {
    url: URL;
    res: http.ServerResponse;
}

export class LoopbackServer {
    private server?: http.Server;
    private port: number = 0;
    private expectedState?: string;
    private pendingCallback?: PendingCallback;
    private waiter?: {
        resolve: (result: LoopbackResult) => void;
        reject: (error: Error) => void;
        timeout: NodeJS.Timeout;
    };
    private settled = false;

    async start(): Promise<number> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => this.handleRequest(req, res));

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

        this.expectedState = expectedState;

        return new Promise((resolve, reject) => {
            this.waiter = {
                resolve,
                reject,
                timeout: setTimeout(() => {
                    this.fail(new Error('Authorization timed out'));
                }, timeoutMs)
            };

            if (this.pendingCallback) {
                const pending = this.pendingCallback;
                this.pendingCallback = undefined;
                this.processCallback(pending.url, pending.res);
            }
        });
    }

    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        let reqUrl: URL;
        try {
            reqUrl = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);
        } catch {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Bad request');
            return;
        }

        if (reqUrl.pathname !== '/callback') {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }

        if (!this.waiter) {
            this.pendingCallback = { url: reqUrl, res };
            return;
        }

        this.processCallback(reqUrl, res);
    }

    private processCallback(reqUrl: URL, res: http.ServerResponse): void {
        const state = reqUrl.searchParams.get('state') || '';
        const code = reqUrl.searchParams.get('code') || '';
        const error = reqUrl.searchParams.get('error') || '';
        const errorDesc = reqUrl.searchParams.get('error_description') || error;

        if (error) {
            this.sendErrorResponse(res, errorDesc);
            this.fail(new Error(`Yandex authorization error: ${errorDesc}`));
            return;
        }

        if (!this.expectedState || state !== this.expectedState) {
            this.sendErrorResponse(res, 'Invalid state parameter (CSRF verification failed)');
            this.fail(new Error('Yandex authorization CSRF verification failed'));
            return;
        }

        if (!code) {
            this.sendErrorResponse(res, 'Authorization code was not received');
            this.fail(new Error('Yandex authorization code was not received'));
            return;
        }

        this.sendSuccessResponse(res);
        this.succeed({ code });
    }

    private succeed(result: LoopbackResult): void {
        if (this.settled) {
            return;
        }
        this.settled = true;
        if (this.waiter) {
            clearTimeout(this.waiter.timeout);
            this.waiter.resolve(result);
            this.waiter = undefined;
        }
        setTimeout(() => this.stop(), 500);
    }

    private fail(error: Error): void {
        if (this.settled) {
            return;
        }
        this.settled = true;
        if (this.waiter) {
            clearTimeout(this.waiter.timeout);
            this.waiter.reject(error);
            this.waiter = undefined;
        }
        setTimeout(() => this.stop(), 500);
    }

    private sendSuccessResponse(res: http.ServerResponse) {
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Arni Code — Yandex ID</title>
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
    <h1>Signed in with Yandex ID</h1>
    <p>Authorization in Arni Code succeeded.<br>You can close this page and return to the editor.</p>
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
        const safeMessage = escapeHtml(message);
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Arni Code — Sign-in error</title>
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
    <h1>Authorization error</h1>
    <p>${safeMessage}</p>
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
        if (this.waiter) {
            clearTimeout(this.waiter.timeout);
            this.waiter = undefined;
        }
        if (this.server) {
            try {
                this.server.close();
            } catch {
                // ignore
            }
            this.server = undefined;
        }
    }
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
