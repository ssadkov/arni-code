# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root.
"""Create the landing test project: a course brief the agent turns into a one-page site."""
import hashlib
import json
from pathlib import Path
import sys

BRIEF = """# Бриф: лендинг курса

Тестовые данные кейса. Тексты можно переписать живее, факты — нет.

- Название курса: AI-агенты для бизнеса
- Организатор: Арнион (ТОО «Эдбиз»)
- Старт: 02.11.2026, 4 недели, онлайн, занятия по понедельникам и четвергам в 19:00 (Астана)
- Стоимость: 450 000 тенге
- Для кого: владельцы малого бизнеса, руководители отделов, бухгалтеры и офис-менеджеры, которые хотят поручать рутину агенту, а не писать код.
- Результат: каждый участник уходит с тремя работающими сценариями в Arni Code на своих данных.

## Программа

1. Что такое AI-агент и где он экономит время
2. Документы: договоры, счета и акты по реквизитам
3. Сайты и формы: лендинг за вечер
4. Свой агент для отдела: навыки, проверки, бюджет

## Частые вопросы

- Нужно ли уметь программировать? Нет. Агент пишет код сам, участник ставит задачу и проверяет результат.
- Что нужно для участия? Компьютер на Windows или macOS и установленный Arni Code; установку разбираем на первом занятии.
- Будут ли записи? Да, записи всех занятий остаются у участников.

## Контакты

E-mail, телефон, БИН и юридическое название организатора возьми со страницы https://arnion.kz/contacts/ .
Кнопка записи открывает письмо на этот e-mail.
"""


def main() -> None:
	target = Path(sys.argv[1] if len(sys.argv) > 1 else 'C:/work/test-arni-landing').resolve()
	if (target / 'brief.md').exists():
		sys.exit(f'{target} already contains brief.md; remove it or choose another folder')
	target.mkdir(parents=True, exist_ok=True)
	brief = target / 'brief.md'
	brief.write_text(BRIEF, encoding='utf-8')
	manifest = {'brief': brief.name, 'sha256': hashlib.sha256(brief.read_bytes()).hexdigest()}
	(target / '.case.json').write_text(json.dumps(manifest, ensure_ascii=False, indent='\t'), encoding='utf-8')
	print(f'Created {target}')


if __name__ == '__main__':
	main()
