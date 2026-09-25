#!/usr/bin/env python3
"""Root-owned controller for one dedicated VM; no shell evaluation of inputs."""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request

STATE = Path('/var/lib/one-concept')
ROOT = Path('/opt/one-concept')
CONFIG = Path('/etc/one-concept')
IMAGE_PREFIX = 'ghcr.io/coding-moves/one-concept-backend@sha256:'
JOBS = {
    'reminders': (['python', '-m', 'app.workers.reminders'], 600, 25 * 60),
    'pool_topup': (['python', '-m', 'app.workers.pool_topup'], 3600, 36 * 3600),
    'observe': (['python', '-m', 'app.workers.content', 'report', '--observe'], 300, 90 * 60),
}
DOCKER = ['docker', '--host', 'unix:///var/run/docker.sock']


def run(args, *, capture=False, timeout=300, check=True, env=None):
    return subprocess.run(args, check=check, timeout=timeout, text=True,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.PIPE if capture else None, env=env)


def atomic_json(path, value, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(value, stream)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    temporary.chmod(mode)
    temporary.replace(path)


def current():
    return json.loads((STATE / 'current.json').read_text())


@contextmanager
def lock(name, *, shared=False, blocking=True):
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / f'{name}.lock').open('a') as stream:
        fcntl.flock(stream, (fcntl.LOCK_SH if shared else fcntl.LOCK_EX)
                    | (0 if blocking else fcntl.LOCK_NB))
        yield


def compose(release, *args, **kwargs):
    env = {**os.environ, 'BACKEND_IMAGE': release['image'],
           'APP_REVISION': release['revision'],
           'GENERATION_ENABLED': str(release.get('generation', False)).lower()}
    return run([*DOCKER, 'compose', '--project-name', 'one-concept',
                '--env-file', str(CONFIG / 'host.env'),
                '-f', str(ROOT / 'releases' / release['revision'] / 'compose.yaml'), *args],
               env=env, **kwargs)


def validate_target(revision, image):
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('A full lowercase commit SHA is required')
    if not re.fullmatch(re.escape(IMAGE_PREFIX) + r'[0-9a-f]{64}', image):
        raise ValueError('An immutable digest from the backend image repository is required')


def verify_main(revision):
    request = urllib.request.Request(
        'https://api.github.com/repos/Coding-Moves/one-concept/commits/main',
        headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'one-concept-deploy'},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        head = json.load(response)['sha']
    if head != revision:
        raise ValueError('Deployment revision must equal current production main')


def materialize(release):
    """Extract only the operations shipped inside the verified immutable image."""
    run([*DOCKER, 'pull', release['image']], timeout=900)
    label = run([*DOCKER, 'image', 'inspect', '--format',
                 '{{index .Config.Labels "org.opencontainers.image.revision"}}',
                 release['image']], capture=True).stdout.strip()
    if label != release['revision']:
        raise ValueError('Image revision does not match requested commit')
    destination = ROOT / 'releases' / release['revision']
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='release-', dir=destination.parent))
    container = run([*DOCKER, 'create', release['image']], capture=True).stdout.strip()
    try:
        run([*DOCKER, 'cp', f'{container}:/app/operations/.', str(temporary)])
        if any(p.is_symlink() for p in temporary.rglob('*')):
            raise ValueError('Operations package must not contain symlinks')
        # No writable deployment scripts for the SSH identity or containers.
        for path in [temporary, *temporary.rglob('*')]:
            os.chown(path, 0, 0)
            path.chmod(0o755 if path.is_dir() else 0o644)
        if destination.exists():
            shutil.rmtree(temporary)
        else:
            temporary.rename(destination)
    finally:
        run([*DOCKER, 'rm', '-f', container], check=False)
        if temporary.exists():
            shutil.rmtree(temporary)


def pause_jobs():
    (STATE / 'jobs-enabled').unlink(missing_ok=True)
    run(['systemctl', 'disable', '--now', *[f'one-concept-{job}.timer' for job in JOBS]])


def enable_jobs():
    (STATE / 'jobs-enabled').touch(mode=0o600)
    run(['systemctl', 'enable', '--now', *[f'one-concept-{job}.timer' for job in JOBS]])


def install_units(release):
    directory = ROOT / 'releases' / release['revision'] / 'systemd'
    for source in directory.glob('one-concept-*'):
        shutil.copyfile(source, Path('/etc/systemd/system') / source.name)
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', 'one-concept-monitor.timer', 'one-concept-prune.timer'])


def health(release):
    script = ("import json,urllib.request; "
              "d=json.load(urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=10)); "
              f"assert d['status']=='ok' and d['revision']=={release['revision']!r}")
    for _ in range(12):
        if compose(release, 'exec', '-T', 'api', 'python', '-c', script,
                   capture=True, check=False, timeout=15).returncode == 0:
            return
        time.sleep(5)
    raise RuntimeError('Candidate API failed database/revision readiness')


def schema(release):
    compose(release, 'run', '--rm', '--no-deps', 'job',
            'python', '-m', 'app.workers.schema_check', timeout=60)


def point_current(release):
    temporary = ROOT / 'current.next'
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(ROOT / 'releases' / release['revision'])
    temporary.replace(ROOT / 'current')
    atomic_json(STATE / 'current.json', release)


def deploy(revision, image, *, rollback=False):
    validate_target(revision, image)
    if not rollback:
        verify_main(revision)
    candidate = {'revision': revision, 'image': image, 'generation': False}
    # Serialize even the preparation stage. The worker lock below lets already
    # running jobs finish before any API/image switch (bounded by their timeout).
    with lock('deployment'):
        old = current() if (STATE / 'current.json').exists() else None
        materialize(candidate)
        schema(candidate)  # Failure here leaves the existing API/jobs untouched.
        was_enabled = (STATE / 'jobs-enabled').exists()
        pause_jobs()
        with lock('runtime'):
            try:
                if old:
                    compose(old, 'stop', 'api', timeout=90)
                compose(candidate, 'up', '-d', '--remove-orphans', 'api', 'proxy', timeout=180)
                health(candidate)
                install_units(candidate)
                point_current(candidate)
                if old and old['revision'] != revision:
                    atomic_json(STATE / 'previous.json', old)
                # Existing scheduler ownership carries forward; initial cutover
                # needs the explicit enable-jobs attestation from the operator.
                if was_enabled:
                    enable_jobs()
            except BaseException:
                compose(candidate, 'stop', 'api', check=False, timeout=90)
                if old:
                    old['generation'] = False
                    compose(old, 'up', '-d', 'api', 'proxy', timeout=180)
                    health(old)
                    point_current(old)
                # Keep jobs/generation paused after failure; operator inspects
                # the restored revision and resumes exactly one scheduler set.
                raise
    monitor()
    print(json.dumps({'deployed_revision': revision, 'generation_enabled': False,
                      'jobs_enabled': (STATE / 'jobs-enabled').exists()}))


def run_job(job):
    command, timeout, _ = JOBS[job]
    with lock('runtime', shared=True), lock(job, blocking=False):
        if not (STATE / 'jobs-enabled').exists():
            print('Scheduler paused; no job dispatched')
            return
        release = current()
        stamp = {'revision': release['revision'], 'image': release['image'],
                 'started_at': time.time(), 'finished_at': None, 'ok': False}
        path = STATE / f'{job}.json'
        if path.exists():
            previous = json.loads(path.read_text())
            stamp['last_success_at'] = previous.get('last_success_at')
            stamp['last_success_revision'] = previous.get('last_success_revision')
        atomic_json(path, stamp)
        name = f'one-concept-job-{job}'
        # A crashed client/host must not leave an orphan performing the same job.
        run([*DOCKER, 'rm', '-f', name], check=False, capture=True)
        try:
            compose(release, 'run', '--rm', '--no-deps', '--name', name, 'job',
                    *command, timeout=timeout)
            stamp['ok'] = True
            stamp['last_success_at'] = time.time()
            stamp['last_success_revision'] = release['revision']
        finally:
            run([*DOCKER, 'rm', '-f', name], check=False, capture=True)
            stamp['finished_at'] = time.time()
            atomic_json(path, stamp)


def monitor():
    release = current()
    problems = []
    if not (STATE / 'jobs-enabled').exists():
        problems.append('schedulers_paused')
    usage = shutil.disk_usage(STATE)
    if usage.free < 2 * 1024 ** 3 or usage.free / usage.total < 0.10:
        problems.append('disk_low')
    memory = dict((line.split(':')[0], int(line.split()[1]))
                  for line in Path('/proc/meminfo').read_text().splitlines())
    if memory['MemAvailable'] / memory['MemTotal'] < 0.08:
        problems.append('memory_low')
    for job, (_, _, max_age) in JOBS.items():
        timer = run(['systemctl', 'is-active', f'one-concept-{job}.timer'], capture=True, check=False)
        if timer.returncode:
            problems.append(f'{job}_timer_inactive')
        try:
            stamp = json.loads((STATE / f'{job}.json').read_text())
            running = stamp['finished_at'] is None and time.time() - stamp['started_at'] <= JOBS[job][1]
            recent = (stamp.get('last_success_revision') == release['revision']
                      and time.time() - (stamp.get('last_success_at') or 0) <= max_age)
            if not recent or not (stamp['ok'] or running):
                problems.append(f'{job}_not_current_or_overdue')
        except (OSError, ValueError, KeyError):
            problems.append(f'{job}_no_evidence')
    result = {'status': 'ok' if not problems else 'degraded',
              'revision': release['revision'], 'checked_at': time.time(), 'problems': problems}
    atomic_json(STATE / 'public' / 'health.json', result, mode=0o644)
    print(json.dumps(result))
    return not problems


def status(revision):
    with lock('runtime', shared=True):
        release = current()
        if release['revision'] != revision:
            raise ValueError('Running revision differs from release request')
        schema(release)
        health(release)
        if not monitor():
            raise RuntimeError('Workers or host are not ready; inspect operational health')
        print(json.dumps({'release_ready': True, 'revision': revision, 'image': release['image']}))


def prune():
    """Only this application's images; never remove current or previous digest."""
    with lock('deployment'), lock('runtime'):
        releases = [current()]
        if (STATE / 'previous.json').exists():
            releases.append(json.loads((STATE / 'previous.json').read_text()))
        keep_ids = {run([*DOCKER, 'image', 'inspect', '--format', '{{.Id}}', release['image']],
                        capture=True).stdout.strip() for release in releases}
        images = run([*DOCKER, 'image', 'ls', '--no-trunc', '--format', '{{.ID}}',
                      '--filter', 'label=org.opencontainers.image.source=https://github.com/Coding-Moves/one-concept'],
                     capture=True).stdout.splitlines()
        for image in set(images) - keep_ids:
            run([*DOCKER, 'image', 'rm', image], check=False, capture=True)
        keep_revisions = {release['revision'] for release in releases}
        for directory in (ROOT / 'releases').iterdir():
            if (re.fullmatch(r'[0-9a-f]{40}', directory.name) and directory.name not in keep_revisions
                    and directory.is_dir() and not directory.is_symlink()):
                shutil.rmtree(directory)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('deploy'); p.add_argument('revision'); p.add_argument('image')
    p = sub.add_parser('status'); p.add_argument('revision')
    p = sub.add_parser('run-job'); p.add_argument('job', choices=JOBS)
    p = sub.add_parser('enable-jobs'); p.add_argument('--old-schedulers-stopped', action='store_true', required=True)
    sub.add_parser('pause-jobs'); sub.add_parser('monitor'); sub.add_parser('rollback'); sub.add_parser('prune')
    p = sub.add_parser('generation'); p.add_argument('mode', choices=['on', 'off'])
    p = sub.add_parser('content'); p.add_argument('args', nargs=argparse.REMAINDER)
    p = sub.add_parser('ssh'); p.add_argument('request')
    args = parser.parse_args(argv)
    if os.geteuid() != 0:
        raise SystemExit('Run through sudo on the dedicated application VM')
    if args.command == 'ssh':
        # The dedicated key cannot open a shell, run content operations, toggle
        # generation, or activate an initial cutover.
        words = args.request.split()
        if len(words) == 3 and words[0] == 'deploy':
            validate_target(words[1], words[2])
        elif len(words) == 2 and words[0] == 'status' and re.fullmatch(r'[0-9a-f]{40}', words[1]):
            pass
        else:
            raise ValueError('This key permits deploy/status with validated arguments only')
        return main(words)
    if args.command == 'deploy':
        deploy(args.revision, args.image)
    elif args.command == 'rollback':
        previous = json.loads((STATE / 'previous.json').read_text())
        deploy(previous['revision'], previous['image'], rollback=True)
    elif args.command == 'status':
        status(args.revision)
    elif args.command == 'run-job':
        run_job(args.job)
    elif args.command == 'prune':
        prune()
    elif args.command == 'monitor':
        return 0 if monitor() else 1
    elif args.command == 'pause-jobs':
        pause_jobs()
    elif args.command == 'enable-jobs':
        with lock('runtime'):
            schema(current()); health(current()); enable_jobs()
    elif args.command == 'generation':
        with lock('runtime'):
            release = current()
            schema(release)
            candidate = {**release, 'generation': args.mode == 'on'}
            try:
                compose(candidate, 'up', '-d', 'api', timeout=180)
                health(candidate)
            except BaseException:
                release['generation'] = False
                compose(release, 'up', '-d', 'api', timeout=180)
                atomic_json(STATE / 'current.json', release)
                raise
            atomic_json(STATE / 'current.json', candidate)
    elif args.command == 'content':
        with lock('runtime', shared=True):
            compose(current(), 'run', '--rm', '--no-deps', 'job',
                    'python', '-m', 'app.workers.content', *args.args, timeout=3600)
    return 0


if __name__ == '__main__':
    def interrupted(_signum, _frame):
        raise SystemExit('Interrupted; runtime cleanup requested')
    signal.signal(signal.SIGTERM, interrupted)
    try:
        raise SystemExit(main())
    except Exception as exc:
        # subprocess errors/connection strings may contain secret values.
        print(f'Operation failed ({type(exc).__name__}); inspect private host logs.', file=sys.stderr)
        raise SystemExit(1) from None
