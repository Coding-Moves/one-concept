# Contributing to One Concept

One Concept is a small, single-team, source-available project. The code is here
to read, learn from, run, and share.

## The best way to help: open an issue

Feedback, bug reports, and feature suggestions are genuinely welcome and are the
best way to shape the project. Search existing issues first, then include a
clear title, what happened vs. what you expected, and steps to reproduce for
bugs.
→ https://github.com/Coding-Moves/one-concept/issues

## Using the code

Under the [MIT License](LICENSE) you're free to use, run locally, modify, and
redistribute it. See [backend/README.md](backend/README.md) and
[mobile/README.md](mobile/README.md) for local setup, and
[mobile/DEPLOYMENT.md](mobile/DEPLOYMENT.md) for EAS publication.

## Code changes

We build this as a small team and develop in the open, so we don't generally
take outside pull requests — **issues are the place to contribute.** If
something really needs a code change, open an issue first and we'll take it from
there.

## License

The project is licensed under the [MIT License](LICENSE).

## Local checks for an agreed change

Use Python 3.12 for the backend and Node 24 for mobile. Install dependencies with
`backend/.venv/bin/pip install -r backend/requirements-dev.txt` (after creating the
venv) and `npm ci` in `mobile/`. From `backend/`, run:

```sh
.venv/bin/python -m ruff check --select F,E9 app tests operations
TEST_REQUIRE_DATABASE=1 TEST_CONTAINER_ENGINE=podman .venv/bin/python -m pytest -ra
```

Docker can replace Podman with `TEST_CONTAINER_ENGINE=docker`. The fixture
creates disposable PostgreSQL and never uses a production database. From
`mobile/`, run `npm run typecheck` and `npm test`. Browser/device checks depend on
the affected flow; [mobile test instructions](mobile/tests/README.md) explain them.

Keep small logical commits in one feature PR into develop. Report evidence and
remaining limits. Do not commit `.env`, private backups or credentials. Database
migrations require review and verified application; do not edit the applied ledger
to bypass a check. Deployment/release operations follow [RELEASING.md](RELEASING.md)
and [the VM runbook](docs/VM_DEPLOYMENT.md).
