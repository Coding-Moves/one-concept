#!/usr/bin/env python3
"""External VM-loss, worker heartbeat and certificate-expiry check; no secrets."""
import json
import os
import socket
import ssl
import time
from urllib.parse import urlsplit
from urllib.request import urlopen


def main():
    origin = os.environ['PUBLIC_API_ORIGIN'].rstrip('/')
    url = urlsplit(origin)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.path or url.query or url.fragment:
        raise ValueError('PUBLIC_API_ORIGIN must be an HTTPS origin')
    revisions = []
    for route in ['/health', '/health/operations']:
        with urlopen(origin + route, timeout=15) as response:
            body = json.load(response)
        if body.get('status') != 'ok':
            raise RuntimeError('Service reports degraded health')
        revisions.append(body['revision'])
    if revisions[0] != revisions[1]:
        raise RuntimeError('API and worker health report different revisions')
    if os.environ.get('EXPECTED_REVISION') and revisions[0] != os.environ['EXPECTED_REVISION']:
        raise RuntimeError('Public API revision differs from this release')
    with socket.create_connection((url.hostname, url.port or 443), timeout=10) as connection:
        with ssl.create_default_context().wrap_socket(connection, server_hostname=url.hostname) as secure:
            certificate = secure.getpeercert()
    if ssl.cert_time_to_seconds(certificate['notAfter']) - time.time() < 14 * 86400:
        raise RuntimeError('TLS certificate expires within 14 days')
    print(json.dumps({'status': 'ok', 'revision': revisions[0]}))


if __name__ == '__main__':
    main()
