#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root.
set -euo pipefail

: "${APPLE_API_KEY:?Missing Apple notarization team API key}"
: "${APPLE_API_KEY_ID:?Missing Apple API Key ID}"
: "${APPLE_API_ISSUER:?Missing Apple API Issuer ID}"
: "${RUNNER_TEMP:?Missing runner temporary directory}"
test -f "$1"
KEY_DIR="$(mktemp -d "$RUNNER_TEMP/arni-notary.XXXXXX")"
trap 'rm -rf "$KEY_DIR"' EXIT
chmod 700 "$KEY_DIR"
printf '%s' "$APPLE_API_KEY" > "$KEY_DIR/AuthKey.p8"
chmod 600 "$KEY_DIR/AuthKey.p8"
xcrun notarytool submit "$1" --key "$KEY_DIR/AuthKey.p8" \
	--key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" \
	--wait --timeout 60m --output-format json > "$KEY_DIR/result.json"
# A successfully uploaded submission can still be Invalid: fail before publishing.
python3 - "$KEY_DIR/result.json" <<'PY'
import json, sys
result = json.load(open(sys.argv[1]))
print('Notarization submission:', result.get('id'), 'status:', result.get('status'))
if result.get('status') != 'Accepted':
    raise SystemExit('Apple did not accept this artifact')
PY
