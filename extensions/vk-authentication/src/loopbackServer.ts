import * as http from 'node:http';
import * as url from 'node:url';

export interface LoopbackResult {
    code: string;
    deviceId: string;
}

export class LoopbackServer {
    private server?: http.Server;
    private port: number = 0;

    async start(preferredPort: number): Promise<number> {
        this.port = await this.listen(preferredPort);
        return this.port;
    }

    private listen(port: number): Promise<number> {
        return new Promise((resolve, reject) => {
            const server = http.createServer();
            server.once('error', reject);
            server.listen(port, '127.0.0.1', () => {
                const addr = server.address();
                if (addr && typeof addr === 'object') {
                    this.server = server;
                    resolve(addr.port);
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
                reject(new Error('Время ожидания авторизации истекло'));
            }, timeoutMs);

            this.server?.on('request', (req, res) => {
                const reqUrl = url.parse(req.url || '', true);
                const pathname = reqUrl.pathname || '/';
                if (pathname !== '/callback' && pathname !== '/') {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('Not found');
                    return;
                }

                const query = reqUrl.query;
                const state = query.state as string;
                const code = query.code as string;
                const deviceId = (query.device_id as string) || '';
                const error = query.error as string;
                const errorDesc = (query.error_description as string) || error;

                if (error) {
                    clearTimeout(timeout);
                    this.sendErrorResponse(res, errorDesc);
                    setTimeout(() => this.stop(), 500);
                    reject(new Error(`Ошибка авторизации VK: ${errorDesc}`));
                    return;
                }

                if (state !== expectedState) {
                    this.sendErrorResponse(res, 'Неверный параметр безопасности state');
                    return;
                }

                if (!code || !deviceId) {
                    this.sendErrorResponse(res, 'VK не вернул code или device_id');
                    return;
                }

                clearTimeout(timeout);
                this.sendSuccessResponse(res);
                setTimeout(() => this.stop(), 500);
                resolve({ code, deviceId });
            });
        });
    }

    private sendSuccessResponse(res: http.ServerResponse) {
        this.sendHtml(res, 200, 'Вход через VK выполнен', 'Авторизация в Arni Code прошла успешно. Можно закрыть эту страницу.');
    }

    private sendErrorResponse(res: http.ServerResponse, message: string) {
        this.sendHtml(res, 400, 'Ошибка авторизации', escapeHtml(message));
    }

    private sendHtml(res: http.ServerResponse, status: number, title: string, message: string) {
        const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:sans-serif;background:#1e1e1e;color:#f0f0f0;display:flex;align-items:center;justify-content:center;height:100vh">
<div style="max-width:440px;text-align:center"><h1>${escapeHtml(title)}</h1><p>${message}</p></div>
</body></html>`;
        res.writeHead(status, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': Buffer.byteLength(html, 'utf-8'),
        });
        res.end(html);
    }

    stop() {
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
    return value.replace(/[&<>"']/g, ch => {
        switch (ch) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            default: return '&#39;';
        }
    });
}
