#!/usr/bin/env bash
# Crée le brouillon WordPress de l'article (jamais publié : status=draft).
set -euo pipefail
cd "$(dirname "$0")"
python3 - <<'PY' > /tmp/bv-payload.json
import json
d=json.load(open("gemini-personal-intelligence.draft.json"))
d["content"]=open("gemini-personal-intelligence.wp.html",encoding="utf-8").read()
print(json.dumps(d))
PY
curl -sS -X POST https://big-view.fr/wp-json/wp/v2/posts \
  -H "Content-Type: application/json" --data-binary @/tmp/bv-payload.json \
  | python3 -c "import json,sys;r=json.load(sys.stdin);print(r.get('id'),r.get('status'),r.get('link'),r.get('message',''))"
