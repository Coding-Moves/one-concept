#!/usr/bin/env python3
"""Smoke-test a backend image on a private disposable container network."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('image')
    parser.add_argument('--engine', default='docker', choices=['docker', 'podman'])
    args = parser.parse_args()
    name = 'one-concept-smoke-' + uuid.uuid4().hex[:10]
    database, api = name + '-db', name + '-api'
    root = Path(__file__).resolve().parents[2]

    def run(*command, **kwargs):
        return subprocess.run([args.engine, *command], check=True, text=True, **kwargs)

    def execute_sql(sql):
        run('exec', '-i', database, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', input=sql)

    run('network', 'create', name)
    try:
        run('run', '-d', '--name', database, '--network', name,
            '-e', 'POSTGRES_PASSWORD=test-only', 'docker.io/library/postgres:16')
        for _ in range(60):
            ready = subprocess.run([args.engine, 'exec', database, 'pg_isready', '-U', 'postgres'], capture_output=True)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('Disposable PostgreSQL did not become ready')
        execute_sql((root / 'backend/tests/auth_stub.sql').read_text())
        for migration in sorted((root / 'backend/migrations').glob('0*.sql')):
            execute_sql(migration.read_text())
        environment = []
        for value in [f'DATABASE_URL=postgresql://postgres:test-only@{database}:5432/postgres',
                      f'DIRECT_URL=postgresql://postgres:test-only@{database}:5432/postgres',
                      'SUPABASE_URL=https://test.invalid', 'SUPABASE_JWKS_URL=https://test.invalid/jwks',
                      'GENERATION_ENABLED=false', 'ENVIRONMENT=production']:
            environment += ['-e', value]
        base = ['run', '--rm', '--network', name, *environment, args.image]
        run(*base, 'python', '-c', 'import os,asyncpg; assert os.getuid()==10001; print("Non-root asyncpg import passed")')
        run(*base, 'python', '-m', 'app.workers.schema_check')
        for module, extra in [('reminders', []), ('pool_topup', []), ('rewrite_catalog', []), ('content', ['report', '--observe']),
                              ('content', ['import-subjects', 'content/subjects.json']), ('content', ['--help'])]:
            run(*base, 'python', '-m', f'app.workers.{module}', *extra)
        run('run', '-d', '--name', api, '--network', name, *environment, args.image)
        probe = "import json,urllib.request; d=json.load(urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=10)); assert d['database']=='reachable'; print(json.dumps(d))"
        for _ in range(20):
            result = subprocess.run([args.engine, 'exec', api, 'python', '-c', probe], capture_output=True, text=True)
            if result.returncode == 0:
                print(result.stdout)
                break
            time.sleep(1)
        else:
            raise RuntimeError('Image API did not become healthy')
        # A copied ledger is insufficient. Actual schema damage must block activation.
        execute_sql('alter table public.concept_backlog drop column claimed_at;')
        bad = subprocess.run([args.engine, *base, 'python', '-m', 'app.workers.schema_check'], capture_output=True, text=True)
        if bad.returncode != 1 or not json.loads(bad.stdout)['errors']:
            raise RuntimeError('Image accepted a missing required schema column')
        print('PASS: image API, workers, imports, non-root user and failing schema gate')
    finally:
        for container in [api, database]:
            subprocess.run([args.engine, 'rm', '-f', container], capture_output=True)
        subprocess.run([args.engine, 'network', 'rm', name], capture_output=True)


if __name__ == '__main__':
    main()
