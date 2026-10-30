# Copyright (c) Microsoft Corporation. Licensed under the MIT License.
"""Prepare Arni's private XLSX environment once; never install into system Python."""
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time


PACKAGES = {
    'openpyxl': ('3.1.5', '5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2'),
    'et-xmlfile': ('2.0.0', '7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa'),
    'defusedxml': ('0.7.1', 'a352e7e428770286cc899e2542b6cdaedb2b4953ff269a210103ec58f6198a61'),
}
REQUIREMENTS = '\n'.join(name + '==' + version + ' --hash=sha256:' + digest
                         for name, (version, digest) in PACKAGES.items()) + '\n'
VERSIONS = {name: package[0] for name, package in PACKAGES.items()}
CHECK = (
    'import importlib.metadata, json; import openpyxl, defusedxml; '
    'print(json.dumps({name: importlib.metadata.version(name) for name in '
    + repr(list(VERSIONS)) + '}))'
)


def runtime_directory():
    """A versioned user-owned cache, independent of the app and project directories."""
    base = Path(os.environ.get('ARNI_TABLES_RUNTIME_DIR', Path.home() / '.arni-code' / 'runtimes'))
    digest = hashlib.sha256(REQUIREMENTS.encode('utf8')).hexdigest()[:16]
    return base / ('xlsx-' + digest + '-py' + str(sys.version_info.major) + '.' + str(sys.version_info.minor)
                   + '-' + platform.machine().lower())


def python_path(directory):
    return directory / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def healthy(executable):
    if not executable.is_file():
        return False
    try:
        result = subprocess.run([str(executable), '-I', '-c', CHECK], capture_output=True, text=True, timeout=15, check=True)
        return json.loads(result.stdout) == VERSIONS
    except (OSError, ValueError, subprocess.SubprocessError):
        return False


def prepare():
    if sys.version_info < (3, 8):
        raise RuntimeError('XLSX support needs Python 3.8 or newer. No system packages were changed.')
    directory = runtime_directory()
    executable = python_path(directory)
    if healthy(executable):
        return executable
    directory.parent.mkdir(parents=True, exist_ok=True)
    lock = directory.with_name(directory.name + '.lock')
    deadline = time.monotonic() + 180
    announced_wait = False
    while True:
        try:
            handle = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(handle)
            break
        except FileExistsError:
            try:
                if time.time() - lock.stat().st_mtime > 600:
                    lock.unlink()
                    continue
            except FileNotFoundError:
                continue
            if time.monotonic() >= deadline:
                raise RuntimeError('XLSX preparation is already running. Retry after it finishes.')
            if not announced_wait:
                print('Arni: waiting for XLSX preparation in another task...', file=sys.stderr, flush=True)
                announced_wait = True
            time.sleep(0.2)
    try:
        if healthy(executable):
            return executable
        print('Arni: preparing XLSX support once in a private environment...', file=sys.stderr, flush=True)
        # Calling the interpreter explicitly avoids activation scripts, sudo and PATH changes.
        subprocess.run([sys.executable, '-I', '-m', 'venv', str(directory)], check=True, timeout=60,
                       stdout=sys.stderr, stderr=sys.stderr)
        # Keep the pinned list in the script: skill bundles already include Python sources.
        requirements = directory / 'arni-requirements.txt'
        requirements.write_text(REQUIREMENTS, encoding='utf8')
        subprocess.run([str(executable), '-I', '-m', 'pip', '--isolated', 'install',
                        '--disable-pip-version-check', '--no-input', '--only-binary=:all:', '--no-deps', '--force-reinstall',
                        '--require-hashes', '--index-url', 'https://pypi.org/simple', '-r', str(requirements)],
                       check=True, timeout=120, stdout=sys.stderr, stderr=sys.stderr)
        if not healthy(executable):
            raise RuntimeError('XLSX preparation finished but verification failed.')
        print('Arni: XLSX support is ready. Future runs reuse this environment.', file=sys.stderr, flush=True)
        return executable
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError('Could not prepare XLSX support. Check Python venv/pip and network access, then retry. '
                           'System Python and source workbooks were not changed.') from error
    finally:
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        print(json.dumps({'status': 'ready', 'python_executable': str(prepare())}, ensure_ascii=True))
    except (OSError, RuntimeError) as error:
        print(json.dumps({'status': 'failed', 'reason': str(error)}, ensure_ascii=True), file=sys.stderr)
        sys.exit(2)
