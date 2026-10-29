# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root.
"""Create a fresh project folder for one model run of one case and print its prompt and check command.

Every run gets its own folder, so an agent cannot reuse scripts or results left by a previous model.
Usage: python test/arni-cases/new_run.py <contract-kz|landing|pptx-update> <model-label> [--root C:/work/arni-runs]
"""
import argparse
from datetime import datetime
from pathlib import Path
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
CHECKS = {
	'contract-kz': ['python', 'test/arni-cases/contract-kz/check.py'],
	'landing': ['node', 'test/arni-cases/landing/check.mjs'],
	'pptx-update': ['python', 'test/arni-cases/pptx-update/check.py'],
}


def case_prompt(case: str) -> str:
	readme = (HERE / case / 'README.md').read_text(encoding='utf-8')
	match = re.search(r'^## Промпт.*?```text\n(?P<prompt>.*?)```', readme, re.S | re.M)
	if not match:
		sys.exit(f'No prompt block in {case}/README.md')
	return match.group('prompt').strip()


def main() -> None:
	parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
	parser.add_argument('case', choices=sorted(CHECKS))
	parser.add_argument('model', help='short label for the folder name, e.g. kimi-k2.5 or haiku-4.5')
	parser.add_argument('--root', default='C:/work/arni-runs')
	args = parser.parse_args()

	label = re.sub(r'[^A-Za-z0-9.-]+', '-', args.model).strip('-').lower()
	target = Path(args.root) / f'{args.case}-{label}-{datetime.now():%Y%m%d-%H%M}'
	if target.exists():
		sys.exit(f'{target} already exists; wait a minute or choose another label')
	subprocess.run([sys.executable, str(HERE / args.case / 'build_project.py'), str(target)], check=True)

	prompt = case_prompt(args.case)
	sys.stdout.reconfigure(encoding='utf-8')
	print(f'\n1. Откройте в Arni папку: {target}\n2. Новый чат, модель: {args.model}\n3. Промпт:\n\n{prompt}\n')
	print('4. Проверка после ответа агента (из папки репозитория):\n   ' + ' '.join([*CHECKS[args.case], str(target).replace('\\', '/')]))
	if sys.platform == 'win32':
		subprocess.run('clip', input=prompt.encode('utf-16'), check=False)
		print('\nПромпт скопирован в буфер обмена.')


if __name__ == '__main__':
	main()
