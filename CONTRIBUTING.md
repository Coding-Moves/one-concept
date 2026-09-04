# Contributing to one-concept

Thanks for your interest in contributing! We welcome issues, bug reports, feature requests, and pull requests.

## Filing issues
- Search existing issues first to avoid duplicates.
- When opening a new issue, include a short title, a description of the problem or feature, steps to reproduce (if applicable), and the expected behavior.

## Branch model and releases

- **`develop`** is the default branch. All feature and fix PRs target it.
- **`main`** is production. Only release PRs (develop → main) merge into it.
- Merging a release PR tags the commit and publishes a GitHub Release named
  after the app version in `mobile/app.json` — bump that version as part of
  the release PR. Backend deploys and the production OTA update follow the
  merge automatically; develop merges update the preview channel only.
- A native mobile change (new native module, icons, `app.json` native config)
  additionally needs a new APK build and a manual `runtimeVersion` bump — see
  `mobile/DEPLOYMENT.md`.

## Contributing code
1. Fork the repository.
2. Create a descriptive branch: `fix/short-description` or `feat/short-description`.
3. Make small, focused changes and add tests where appropriate.
4. Run the project's tests and linters (if present) before committing.
5. Open a pull request against the `develop` branch with a clear description of what you changed and why.

## Coding style
- This repository primarily uses TypeScript and Python. Please follow the project's existing style.
- For TypeScript: prefer Prettier and ESLint if configured in the project.
- For Python: prefer Black and Flake8 if applicable.

## Commit messages
- Use a short summary line and an optional body. You may follow Conventional Commits (e.g., `fix:`, `feat:`) but it is not required.

## License for contributions
By submitting a pull request, you agree that your contributions will be licensed under the repository's license (MIT).

## Questions or discussion
If you're unsure about something, open an issue or contact the maintainers via the repository discussions or issues page: https://github.com/Coding-Moves/one-concept
