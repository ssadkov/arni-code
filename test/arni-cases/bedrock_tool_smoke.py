# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root.
"""Live Bedrock smoke: one tool call, then exact copy of KZ requisites. Needs boto3 + botocore[crt] and the arni-bedrock-audit profile; costs well under a cent per model."""
import boto3, json, time, sys
c = boto3.Session(profile_name='arni-bedrock-audit', region_name='us-east-1').client('bedrock-runtime')
tool = {'toolSpec': {'name': 'read_url', 'description': 'Fetch a web page and return its text',
	'inputSchema': {'json': {'type': 'object', 'properties': {'url': {'type': 'string'}}, 'required': ['url']}}}}
msg = [{'role': 'user', 'content': [{'text': 'Возьми реквизиты компании со страницы https://arnion.kz/contacts/ . Сначала вызови инструмент.'}]}]
page = 'ТОО «Эдбиз» БИН 221040013762 Юридический адрес: Казахстан, 010000, Астана, район Алматы, улица Бейімбет Майлин, здание 19 Банк: АО Банк ЦентрКредит Номер счета: KZ388562203125947874 БИК: KCJBKZKX КБе: 17'
for m in sys.argv[1:]:
	t = time.time()
	try:
		r = c.converse(modelId=m, messages=msg, toolConfig={'tools': [tool]}, inferenceConfig={'maxTokens': 400})
		calls = [b['toolUse'] for b in r['output']['message']['content'] if 'toolUse' in b]
		ok1 = bool(calls) and 'arnion.kz' in json.dumps(calls[0]['input'])
		u = r['usage']
		if not ok1:
			print(f'{m:45} FAIL no tool call; stop={r["stopReason"]}'); continue
		msg2 = msg + [r['output']['message'], {'role': 'user', 'content': [{'toolResult': {'toolUseId': calls[0]['toolUseId'], 'content': [{'text': page}]}}]},
			{'role': 'user', 'content': [{'text': 'Выведи ИИК, БИН и улицу юр. адреса строго как в источнике, по одному в строке.'}]}]
		# Converse requires alternating roles: merge the last two user turns.
		msg2 = msg2[:-2] + [{'role': 'user', 'content': msg2[-2]['content'] + msg2[-1]['content']}]
		r2 = c.converse(modelId=m, messages=msg2, toolConfig={'tools': [tool]}, inferenceConfig={'maxTokens': 400})
		txt = ''.join(b.get('text', '') for b in r2['output']['message']['content'])
		exact = all(s in txt for s in ['KZ388562203125947874', '221040013762', 'Бейімбет Майлин'])
		print(f'{m:45} tool=OK exact={"OK" if exact else "FAIL"} {time.time()-t:5.1f}s in={u["inputTokens"]+r2["usage"]["inputTokens"]} out={u["outputTokens"]+r2["usage"]["outputTokens"]}' + ('' if exact else ' | ' + txt.replace(chr(10), ' / ')[:160]))
	except Exception as e:
		print(f'{m:45} ERROR {type(e).__name__}: {str(e)[:150]}')
