import { execFile } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import type { ServerOptions } from 'node:https';
import * as path from 'node:path';
import * as vscode from 'vscode';

// VK ID only redirects a local app to https://localhost, so the loopback server
// needs a certificate for it. Each user gets their own: a key shipped with the
// build would be public, and the certificate is added to the user's trusted
// roots.
const PFX_FILE = 'localhost.pfx';
const PASSPHRASE_SECRET_KEY = 'vk.localhostCertificate.passphrase';
const KEY_FILE = 'localhost-key.pem';
const CERT_FILE = 'localhost-cert.pem';

/**
 * Returns TLS options for the https://localhost loopback server, creating a
 * per-user self-signed certificate on first use.
 */
export async function ensureLocalhostCertificate(context: vscode.ExtensionContext): Promise<ServerOptions> {
    const directory = path.join(context.globalStorageUri.fsPath, 'localhost-certificate');
    await fs.promises.mkdir(directory, { recursive: true });
    return process.platform === 'win32'
        ? ensureWindowsCertificate(directory, context.secrets)
        : ensureOpenSslCertificate(directory);
}

async function ensureWindowsCertificate(directory: string, secrets: vscode.SecretStorage): Promise<ServerOptions> {
    const pfxPath = path.join(directory, PFX_FILE);
    let passphrase = await secrets.get(PASSPHRASE_SECRET_KEY);
    if (!passphrase || !fs.existsSync(pfxPath)) {
        passphrase = crypto.randomBytes(24).toString('base64url');
        await runPowerShell(createWindowsCertificateScript(pfxPath), { ARNI_LOCALHOST_PFX_PASSPHRASE: passphrase });
        await secrets.store(PASSPHRASE_SECRET_KEY, passphrase);
    }
    return { pfx: await fs.promises.readFile(pfxPath), passphrase };
}

/**
 * Creates a localhost-only certificate (not a CA), exports it with its key to
 * `pfxPath`, removes it from the personal store, and trusts its public part
 * for the current user. Windows asks the user to confirm the trust once.
 */
function createWindowsCertificateScript(pfxPath: string): string {
    const target = pfxPath.replace(/'/g, "''");
    return `
$ErrorActionPreference = 'Stop'
$password = ConvertTo-SecureString $env:ARNI_LOCALHOST_PFX_PASSPHRASE -AsPlainText -Force
$certificate = New-SelfSignedCertificate -DnsName 'localhost' -FriendlyName 'Arni Code VK sign-in (localhost)' -CertStoreLocation 'Cert:\\CurrentUser\\My' -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 -NotAfter (Get-Date).AddYears(5) -TextExtension @('2.5.29.19={text}CA=false', '2.5.29.37={text}1.3.6.1.5.5.7.3.1')
try {
  Export-PfxCertificate -Cert $certificate -FilePath '${target}' -Password $password | Out-Null
  $publicOnly = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2
  $publicOnly.Import($certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
  $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')
  $store.Open('ReadWrite')
  try { $store.Add($publicOnly) } finally { $store.Close() }
} finally {
  Remove-Item -LiteralPath ('Cert:\\CurrentUser\\My\\' + $certificate.Thumbprint) -ErrorAction SilentlyContinue
}
`;
}

async function ensureOpenSslCertificate(directory: string): Promise<ServerOptions> {
    const keyPath = path.join(directory, KEY_FILE);
    const certPath = path.join(directory, CERT_FILE);
    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
        await run('openssl', [
            'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
            '-keyout', keyPath, '-out', certPath, '-days', '1825',
            '-subj', '/CN=localhost',
            '-addext', 'subjectAltName=DNS:localhost',
            '-addext', 'basicConstraints=critical,CA:FALSE',
        ]);
        await fs.promises.chmod(keyPath, 0o600);
    }
    return { key: await fs.promises.readFile(keyPath), cert: await fs.promises.readFile(certPath) };
}

function runPowerShell(script: string, env: Record<string, string>): Promise<void> {
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], env);
}

function run(command: string, args: string[], env?: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(command, args, { windowsHide: true, env: { ...process.env, ...env } }, (error, _stdout, stderr) => {
            if (error) {
                reject(new Error(`Не удалось создать сертификат для входа через VK: ${stderr.trim() || error.message}`));
            } else {
                resolve();
            }
        });
    });
}
