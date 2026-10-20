#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. Licensed under the MIT License.
"""Create a self-contained source-anchored lesson without external resources."""
import argparse
import html
import json
import re
from pathlib import Path
import sys


def create(plan, output):
    title, passage, source = (plan.get(name) for name in ('title', 'passage', 'source'))
    questions = plan.get('questions', [])
    if not all(isinstance(value, str) and value.strip() for value in (title, passage, source)) or len(passage) > 30000:
        raise ValueError('Title, passage and source required; passage limit 30000 characters')
    if not isinstance(questions, list) or not 1 <= len(questions) <= 20:
        raise ValueError('Use 1 to 20 questions')
    for item in questions:
        choices = item.get('choices', [])
        answer = item.get('answer')
        if not isinstance(choices, list) or not 2 <= len(choices) <= 6 or any(not isinstance(s, str) or not s.strip() for s in choices):
            raise ValueError('Each question needs 2 to 6 nonempty choices')
        if type(answer) is not int or not 0 <= answer < len(choices):
            raise ValueError('Answer index is invalid')
        if not all(isinstance(item.get(k), str) and item[k].strip() for k in ('question', 'explanation', 'evidence')) or item['evidence'] not in passage:
            raise ValueError('Question, explanation and an exact passage evidence anchor required')
    data = json.dumps(questions, ensure_ascii=True).replace('<', '\\u003c')
    page = '''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title><style>body{font:18px/1.6 system-ui;max-width:850px;margin:auto;padding:24px;color:#172334;background:#f6f8fb}article,fieldset{background:white;border:1px solid #ccd5e0;border-radius:12px;padding:20px;margin:16px 0}label{display:block;margin:10px 0}button{font:inherit;padding:8px 16px;cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #1266ce}pre{white-space:pre-wrap;font:inherit}legend{font-weight:600}#score{font-weight:bold}</style>
<h1>__TITLE__</h1><p>Источник: __SOURCE__</p><article><h2>Материал</h2><pre>__PASSAGE__</pre></article><h2>Проверьте себя</h2><div id="quiz"></div><p id="score" role="status"></p>
<script>const questions=__QUESTIONS__;const results=new Map();const host=document.querySelector('#quiz');
questions.forEach((q,i)=>{const f=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent=q.question;f.append(legend);q.choices.forEach((text,j)=>{const label=document.createElement('label');const input=document.createElement('input');input.type='radio';input.name='q'+i;input.value=String(j);label.append(input,document.createTextNode(' '+text));f.append(label)});const b=document.createElement('button');b.textContent='Проверить';const feedback=document.createElement('p');feedback.setAttribute('role','status');b.addEventListener('click',()=>{const chosen=f.querySelector('input:checked');if(!chosen){feedback.textContent='Выберите ответ';return}const ok=Number(chosen.value)===q.answer;results.set(i,ok);feedback.textContent=(ok?'Верно. ':'Пока неверно. ')+q.explanation+' Опора на источник: '+q.evidence;document.querySelector('#score').textContent='Верно: '+[...results.values()].filter(Boolean).length+' из '+questions.length});f.append(b,feedback);host.append(f)});
</script></html>'''
    # A single pass never interprets placeholders embedded in user/source text.
    replacements = {'__QUESTIONS__': data, '__TITLE__': html.escape(title),
                    '__SOURCE__': html.escape(source), '__PASSAGE__': html.escape(passage)}
    page = re.sub(r'__(QUESTIONS|TITLE|SOURCE|PASSAGE)__', lambda match: replacements[match[0]], page)
    with Path(output).open('x', encoding='utf-8') as handle:
        handle.write(page)
    return {'output': str(output), 'questions': len(questions), 'evidence_anchors': 'checked', 'browser_check': 'not_performed'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(create(json.loads(args.plan.read_text(encoding='utf-8-sig')), args.output)))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({'status': 'failed', 'reason': str(error)}, ensure_ascii=True), file=sys.stderr)
        sys.exit(2)
