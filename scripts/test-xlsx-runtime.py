# Copyright (c) Microsoft Corporation. Licensed under the MIT License.
"""XLSX runtime regressions. Default tests are offline; --live exercises first installation."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / 'src/vs/sessions/skills/spreadsheet-analysis/scripts'
spec = importlib.util.spec_from_file_location('xlsx_runtime', SCRIPTS / 'xlsx_runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeTest(unittest.TestCase):
    def test_ready_runtime_never_installs_again(self):
        with patch.object(runtime, 'healthy', return_value=True), patch.object(runtime.subprocess, 'run') as run:
            executable = runtime.prepare()
            self.assertEqual(executable, runtime.python_path(runtime.runtime_directory()))
            run.assert_not_called()

    def test_install_is_private_pinned_and_noninteractive(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'ARNI_TABLES_RUNTIME_DIR': temp}), \
                patch.object(runtime, 'healthy', side_effect=[False, False, True]), patch.object(runtime.subprocess, 'run') as run:
            runtime.runtime_directory().mkdir(parents=True)
            executable = runtime.prepare()
            commands = [call.args[0] for call in run.call_args_list]
            self.assertEqual(commands[0], [sys.executable, '-I', '-m', 'venv', str(executable.parent.parent)])
            self.assertEqual(commands[1][0], str(executable))
            self.assertTrue(all(flag in commands[1] for flag in ['--require-hashes', '--no-input', '--only-binary=:all:', '--no-deps']))
            self.assertFalse(list(Path(temp).glob('*.lock')))

    def test_failed_install_releases_lock_and_reports_recoverable_error(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'ARNI_TABLES_RUNTIME_DIR': temp}), \
                patch.object(runtime, 'healthy', return_value=False), \
                patch.object(runtime.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'test')):
            with self.assertRaisesRegex(RuntimeError, 'System Python and source workbooks were not changed'):
                runtime.prepare()
            self.assertFalse(list(Path(temp).glob('*.lock')))

    def test_csv_works_without_preparing_xlsx(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / 'source.csv'
            source.write_text('id,amount\n01,12\n', encoding='utf8')
            result = subprocess.run([sys.executable, '-I', str(SCRIPTS / 'tables.py'), 'inspect', str(source)], capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(result.stdout)['rows'], 1)
            self.assertNotIn('preparing', result.stderr)


def live():
    """Real venv + pinned wheels + read/write/repeat; only synthetic, temporary workbooks."""
    with tempfile.TemporaryDirectory(prefix='arni-xlsx-test-') as temp:
        environment = {**os.environ, 'ARNI_TABLES_RUNTIME_DIR': str(Path(temp) / 'runtimes'), 'PYTHONDONTWRITEBYTECODE': '1'}
        command = [sys.executable, '-I', str(SCRIPTS / 'tables.py')]
        def execute(args):
            return subprocess.run([*command, *args], env=environment, capture_output=True, text=True, check=True, timeout=210)
        first = execute(['prepare'])
        print(first.stderr, file=sys.stderr)
        python = json.loads(first.stdout)['python_executable']
        source = Path(temp) / 'Продажи с пробелами.xlsx'
        create = 'import openpyxl,sys; b=openpyxl.Workbook(); s=b.active; s.append(["id","amount"]); s.append(["001",12]); s.append(["002",8]); b.save(sys.argv[1]); b.close()'
        subprocess.run([python, '-I', '-c', create, str(source)], check=True)
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        inspected = execute(['inspect', str(source)])
        assert json.loads(inspected.stdout)['rows'] == 2
        assert 'preparing' not in inspected.stderr
        other = Path(temp) / 'other.csv'
        other.write_text('id,amount\n001,12\n002,9\n', encoding='utf8')
        output = Path(temp) / 'result.xlsx'
        result = execute(['reconcile', str(source), str(other), '--key', 'id', '--amount', 'amount', '--output', str(output)])
        assert json.loads(result.stdout)['statuses'] == {'matched': 1, 'amount_difference': 1}
        assert hashlib.sha256(source.read_bytes()).hexdigest() == before
        repeat = execute(['prepare'])
        assert not repeat.stderr.strip(), repeat.stderr
        assert json.loads(repeat.stdout)['python_executable'] == python
        print('Live XLSX passed: first setup, Unicode path, workbook read/write, source preserved, cached repeat without pip.')


if __name__ == '__main__':
    if '--live' in sys.argv:
        live()
    else:
        unittest.main()
