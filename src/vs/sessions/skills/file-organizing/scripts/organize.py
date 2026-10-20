#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. Licensed under the MIT License.
"""Plan and journal reversible, non-overwriting moves inside one folder."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

LIMIT = 500
MAX_BYTES = 64 * 1024**2
CATEGORIES = {'.pdf': 'Documents', '.txt': 'Documents', '.docx': 'Documents', '.md': 'Documents',
              '.csv': 'Tables', '.tsv': 'Tables', '.xlsx': 'Tables', '.pptx': 'Presentations',
              '.jpg': 'Images', '.jpeg': 'Images', '.png': 'Images', '.webp': 'Images',
              '.mp4': 'Videos', '.mov': 'Videos', '.mp3': 'Audio', '.wav': 'Audio', '.zip': 'Archives'}


def dump_new(path, data):
    with Path(path).open('x', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=True, indent=2)


def digest(path):
    if path.stat().st_size > MAX_BYTES:
        raise ValueError('File exceeds the 64 MiB limit')
    checksum = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            checksum.update(block)
    return checksum.hexdigest()


def child(root, relative):
    # Reject links/junctions before resolving, including a destination parent.
    value = Path(relative)
    if value.is_absolute() or value.drive or not value.parts or any(part in ('.', '..') or ':' in part for part in value.parts):
        raise ValueError('Unsafe relative path')
    candidate = root
    for part in value.parts:
        candidate = candidate / part
        if candidate.is_symlink() or (hasattr(candidate, 'is_junction') and candidate.is_junction()):
            raise ValueError('Links and junctions are unsupported')
    if not candidate.resolve().is_relative_to(root):
        raise ValueError('Path escapes selected folder')
    return candidate


def plan(source, output):
    source = Path(source)
    if source.is_symlink() or (hasattr(source, 'is_junction') and source.is_junction()):
        raise ValueError('Choose a regular folder')
    root = source.resolve(strict=True)
    if root == Path(root.anchor) or not root.is_dir() or (root / '.git').exists():
        raise ValueError('Choose a disposable/non-repository folder')
    if Path(output).exists():
        raise FileExistsError('Choose a new plan path')
    entries, skipped = [], []
    files = []
    for item in root.iterdir():
        files.append(item)
        if len(files) > LIMIT:
            raise ValueError('Folder exceeds the 500-entry limit; choose a smaller folder')
    for item in sorted(files):
        if item == Path(output).resolve():
            continue
        if item.name.startswith('.') or not item.is_file() or item.is_symlink() or (hasattr(item, 'is_junction') and item.is_junction()):
            skipped.append({'name': item.name, 'reason': 'hidden_folder_or_link'})
            continue
        if item.stat().st_size > MAX_BYTES:
            skipped.append({'name': item.name, 'reason': 'size_limit'})
            continue
        category = CATEGORIES.get(item.suffix.lower(), 'Other')
        relative = str(Path(category) / item.name)
        target = child(root, relative)
        if target.exists():
            skipped.append({'name': item.name, 'reason': 'target_exists'})
            continue
        entries.append({'from': item.name, 'to': relative, 'sha256': digest(item)})
    data = {'schema_version': 1, 'root': str(root), 'moves': entries, 'skipped': skipped}
    dump_new(output, data)
    return data


def validate(data):
    if data.get('schema_version') != 1 or not isinstance(data.get('moves'), list) or len(data['moves']) > LIMIT:
        raise ValueError('Invalid plan/journal')
    root = Path(data['root'])
    if not root.is_absolute() or root.is_symlink() or (hasattr(root, 'is_junction') and root.is_junction()) or root.resolve(strict=True) != root:
        raise ValueError('Root is not a resolved regular folder')
    if root == Path(root.anchor) or not root.is_dir() or (root / '.git').exists():
        raise ValueError('Unsupported root')
    seen = set()
    for entry in data['moves']:
        source, target = child(root, entry['from']), child(root, entry['to'])
        if source.parent != root or target.parent.parent != root or target.parent.name not in set(CATEGORIES.values()) | {'Other'} or source.name != target.name:
            raise ValueError('Moves must retain filenames in one category subfolder')
        for path in (source, target):
            identity = str(path).casefold()
            if identity in seen:
                raise ValueError('Duplicate or overlapping move')
            seen.add(identity)
    return root


def apply(data, journal):
    root = validate(data)
    journal = Path(journal).resolve()
    if any(journal == child(root, entry[side]) for entry in data['moves'] for side in ('from', 'to')):
        raise ValueError('Journal conflicts with a move')
    for entry in data['moves']:
        source, target = child(root, entry['from']), child(root, entry['to'])
        if not source.is_file() or digest(source) != entry['sha256'] or target.exists():
            raise ValueError('Stale plan or target collision; nothing moved')
        if target.parent.exists() and not target.parent.is_dir():
            raise ValueError('Target category is not a folder')
    state = {'schema_version': 1, 'root': str(root), 'moves': [dict(entry, status='pending') for entry in data['moves']]}
    with journal.open('x', encoding='utf-8') as handle:
        def flush():
            handle.seek(0)
            json.dump(state, handle, ensure_ascii=True, indent=2)
            handle.truncate()
            handle.flush()
        flush()
        for entry in state['moves']:
            source, target = child(root, entry['from']), child(root, entry['to'])
            target.parent.mkdir(exist_ok=True)
            # Exclusive creation prevents overwrites, including races after preflight.
            with source.open('rb') as original, target.open('xb') as destination:
                for block in iter(lambda: original.read(1024 * 1024), b''):
                    destination.write(block)
            if digest(target) != entry['sha256'] or digest(source) != entry['sha256']:
                entry['status'] = 'conflict_copy_retained'
                flush()
                raise ValueError('Content changed during move; copies retained, inspect journal')
            entry['status'] = 'copied'
            flush()
            source.unlink()
            entry['status'] = 'moved'
            flush()
    return {'journal': str(journal), 'moved': len(state['moves'])}


def undo(journal):
    journal = Path(journal)
    if journal.is_symlink() or (hasattr(journal, 'is_junction') and journal.is_junction()):
        raise ValueError('Journal links are unsupported')
    state = json.loads(journal.read_text(encoding='utf-8'))
    root = validate(state)
    moves = [entry for entry in state['moves'] if entry.get('status') == 'moved']
    if any(entry.get('status') not in ('moved', 'pending', 'restored') for entry in state['moves']):
        raise ValueError('Interrupted copy requires inspection before undo')
    if any(entry.get('status') == 'pending' and child(root, entry['to']).exists() for entry in state['moves']):
        raise ValueError('Interrupted destination requires inspection')
    for entry in moves:
        source, target = child(root, entry['from']), child(root, entry['to'])
        if source.exists() or not target.is_file() or digest(target) != entry['sha256']:
            raise ValueError('Undo conflict; nothing restored')
    for entry in reversed(moves):
        source, target = child(root, entry['from']), child(root, entry['to'])
        with target.open('rb') as original, source.open('xb') as destination:
            for block in iter(lambda: original.read(1024 * 1024), b''):
                destination.write(block)
        if digest(source) != entry['sha256'] or digest(target) != entry['sha256']:
            raise ValueError('Undo content changed; copies retained')
        target.unlink()
        entry['status'] = 'restored'
        journal.write_text(json.dumps(state, ensure_ascii=True, indent=2), encoding='utf-8')
    return {'restored': len(moves), 'journal': str(journal)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['plan', 'apply', 'undo'])
    parser.add_argument('--source', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--plan', type=Path)
    parser.add_argument('--journal', type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'plan' and args.source and args.output:
            result = plan(args.source, args.output)
        elif args.command == 'apply' and args.plan and args.journal:
            result = apply(json.loads(args.plan.read_text(encoding='utf-8-sig')), args.journal)
        elif args.command == 'undo' and args.journal:
            result = undo(args.journal)
        else:
            parser.error('Provide the paths required by this command')
        print(json.dumps(result, ensure_ascii=True))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({'status': 'failed', 'reason': str(error), 'instruction': 'Inspect the plan/journal; do not retry blindly.'}, ensure_ascii=True), file=sys.stderr)
        sys.exit(2)
