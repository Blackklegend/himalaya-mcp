#!/bin/bash
set -euo pipefail
# Defense in depth only. The server and client independently disable delivery.
# No message content is logged. This hook does not attest human approval.
if ! command -v python3 >/dev/null 2>&1; then
  echo "Cannot validate tool invocation; blocked." >&2
  exit 2
fi
exec python3 -c '
import json, sys
try:
    request = json.load(sys.stdin)
    name = request["tool_name"]
    arguments = request.get("tool_input", {})
    if not isinstance(name, str) or not isinstance(arguments, dict):
        raise ValueError("invalid tool invocation")
    if name.split("__")[-1] in ("send_email", "compose_email"):
        if arguments.get("confirm") not in (None, False):
            print("Delivery disabled in this hardened fork. This hook does not grant approval.", file=sys.stderr)
            sys.exit(2)
except (ValueError, KeyError, TypeError):
    print("Cannot validate tool invocation; blocked.", file=sys.stderr)
    sys.exit(2)
'
