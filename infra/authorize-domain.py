#!/usr/bin/env python3
"""Add one host to Identity Platform's authorized domains, idempotently.

    authorize-domain.py <config.json> <hostname>   >  patch body on stdout

Sign-in popups are refused from any origin Identity Platform does not know about, and a Cloud
Run hostname is generated rather than chosen — so it cannot be authorised ahead of the first
deploy. This reads the current list and prints it back with the host added, which keeps the
PATCH a merge rather than an overwrite: blindly setting the field would silently drop the
Firebase default domains and break the hosted sign-in handler.
"""
import json
import sys


def main() -> int:
    config_path, hostname = sys.argv[1], sys.argv[2].strip()
    with open(config_path) as fh:
        config = json.load(fh)

    if "error" in config:
        print(f"error reading Identity Platform config: {config['error']}", file=sys.stderr)
        return 1

    domains = list(config.get("authorizedDomains") or [])
    if hostname and hostname not in domains:
        domains.append(hostname)

    json.dump({"authorizedDomains": domains}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
