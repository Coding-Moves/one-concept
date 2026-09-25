"""Deployment state-machine failures tested without SSH, Docker or live services."""
import json
import subprocess
import time
from types import SimpleNamespace

import pytest

from operations import manage

REVISION = 'a' * 40
OLD = 'b' * 40
IMAGE = manage.IMAGE_PREFIX + 'c' * 64
OLD_IMAGE = manage.IMAGE_PREFIX + 'd' * 64


@pytest.fixture
def host(tmp_path, monkeypatch):
    for name in ['ROOT', 'STATE', 'CONFIG']:
        path = tmp_path / name
        path.mkdir()
        monkeypatch.setattr(manage, name, path)
    calls = []
    monkeypatch.setattr(manage, 'verify_main', lambda sha: calls.append(('verified', sha)))
    monkeypatch.setattr(manage, 'materialize', lambda release: None)
    monkeypatch.setattr(manage, 'schema', lambda release: calls.append(('schema', release['revision'])))
    monkeypatch.setattr(manage, 'health', lambda release: None)
    monkeypatch.setattr(manage, 'install_units', lambda release: None)
    monkeypatch.setattr(manage, 'monitor', lambda: True)
    monkeypatch.setattr(manage, 'run', lambda args, **kw: SimpleNamespace(returncode=0, stdout=''))
    monkeypatch.setattr(manage, 'compose', lambda release, *args, **kw: calls.append((release.copy(), args)))
    return calls


def existing_host():
    old = {'revision': OLD, 'image': OLD_IMAGE, 'generation': True}
    manage.atomic_json(manage.STATE / 'current.json', old)
    (manage.STATE / 'jobs-enabled').touch()
    return old


def test_schema_failure_cannot_replace_live_image_or_pause_healthy_workers(host, monkeypatch):
    old = existing_host()
    monkeypatch.setattr(manage, 'schema', lambda release: (_ for _ in ()).throw(RuntimeError('missing schema')))
    with pytest.raises(RuntimeError):
        manage.deploy(REVISION, IMAGE)
    assert manage.current() == old
    assert (manage.STATE / 'jobs-enabled').exists()
    assert not any(isinstance(call[0], dict) for call in host)


def test_failed_candidate_restores_previous_api_with_generation_and_timers_paused(host, monkeypatch):
    existing_host()
    def health(release):
        if release['revision'] == REVISION:
            raise RuntimeError('unhealthy candidate')
    monkeypatch.setattr(manage, 'health', health)
    with pytest.raises(RuntimeError):
        manage.deploy(REVISION, IMAGE)
    assert manage.current() == {'revision': OLD, 'image': OLD_IMAGE, 'generation': False}
    assert not (manage.STATE / 'jobs-enabled').exists()
    assert host[-1][0]['revision'] == OLD
    assert host[-1][1] == ('up', '-d', 'api', 'proxy')


def test_initial_deploy_keeps_schedulers_and_generation_off(host):
    manage.deploy(REVISION, IMAGE)
    assert manage.current() == {'revision': REVISION, 'image': IMAGE, 'generation': False}
    assert not (manage.STATE / 'jobs-enabled').exists()


def test_upgrade_carries_existing_scheduler_ownership_but_pauses_generation(host):
    old = existing_host()
    manage.deploy(REVISION, IMAGE)
    assert (manage.STATE / 'jobs-enabled').exists()
    assert not manage.current()['generation']
    assert json.loads((manage.STATE / 'previous.json').read_text()) == old


def test_job_timeout_removes_container_and_records_failed_revision(host, monkeypatch):
    existing_host()
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired('docker', 600)
    monkeypatch.setattr(manage, 'compose', timeout)
    with pytest.raises(subprocess.TimeoutExpired):
        manage.run_job('reminders')
    stamp = json.loads((manage.STATE / 'reminders.json').read_text())
    assert not stamp['ok'] and stamp['finished_at'] is not None
    assert stamp['revision'] == OLD


@pytest.mark.parametrize('request_text', [
    'bash', 'content publish anything', f'deploy {REVISION};id {IMAGE}',
    f'deploy {REVISION} ghcr.io/attacker/image@sha256:' + 'a' * 64,
    f'status {REVISION} --anything', 'enable-jobs --old-schedulers-stopped',
])
def test_deploy_key_rejects_shells_untrusted_images_and_operator_actions(host, monkeypatch, request_text):
    monkeypatch.setattr(manage.os, 'geteuid', lambda: 0)
    with pytest.raises(ValueError):
        manage.main(['ssh', request_text])
    assert host == []


def test_generation_failure_restores_disabled_state_and_api(host, monkeypatch):
    existing_host()
    monkeypatch.setattr(manage.os, 'geteuid', lambda: 0)
    monkeypatch.setattr(manage, 'health', lambda release: (_ for _ in ()).throw(RuntimeError('unhealthy')))
    with pytest.raises(RuntimeError):
        manage.main(['generation', 'on'])
    assert not manage.current()['generation']
    assert host[-1][0]['generation'] is False


def test_pruning_preserves_current_and_previous_images_and_operations(host, monkeypatch):
    existing_host()
    previous = {'revision': REVISION, 'image': IMAGE, 'generation': False}
    manage.atomic_json(manage.STATE / 'previous.json', previous)
    for revision in [OLD, REVISION, 'e' * 40]:
        (manage.ROOT / 'releases' / revision).mkdir(parents=True)
    calls = []
    def run(args, **kwargs):
        calls.append(args)
        if 'inspect' in args:
            output = 'current-id' if args[-1] == OLD_IMAGE else 'previous-id'
        elif 'ls' in args:
            output = 'current-id\nprevious-id\nobsolete-id\n'
        else:
            output = ''
        return SimpleNamespace(returncode=0, stdout=output)
    monkeypatch.setattr(manage, 'run', run)
    manage.prune()
    assert [args[-1] for args in calls if 'rm' in args] == ['obsolete-id']
    assert sorted(path.name for path in (manage.ROOT / 'releases').iterdir()) == sorted([OLD, REVISION])


def test_monitor_requires_recent_success_for_every_worker_at_the_current_revision(host, monkeypatch):
    existing_host()
    # Restore the real monitor while keeping Docker/systemd isolated.
    import importlib.util
    spec = importlib.util.spec_from_file_location('unpatched_manage', manage.__file__)
    real = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(real)
    for name in ['ROOT', 'STATE', 'CONFIG', 'run']:
        setattr(real, name, getattr(manage, name))
    monkeypatch.setattr(real.shutil, 'disk_usage', lambda path: SimpleNamespace(free=10 * 1024**3, total=20 * 1024**3))
    now = time.time()
    for job in manage.JOBS:
        manage.atomic_json(manage.STATE / f'{job}.json', {
            'revision': OLD, 'ok': True, 'started_at': now, 'finished_at': now,
            'last_success_at': now, 'last_success_revision': OLD,
        })
    assert real.monitor()
    stamp = json.loads((manage.STATE / 'reminders.json').read_text())
    stamp['last_success_revision'] = REVISION
    manage.atomic_json(manage.STATE / 'reminders.json', stamp)
    assert not real.monitor()
    stamp['last_success_revision'] = OLD
    stamp['last_success_at'] = now - 26 * 60
    manage.atomic_json(manage.STATE / 'reminders.json', stamp)
    assert not real.monitor()
