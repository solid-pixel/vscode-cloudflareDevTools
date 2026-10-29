# Changelog

All notable changes to this project will be documented in this file.

## **1.1.0**

- Add scoped API token authentication using VS Code's encrypted secret storage, with commands to save or remove a token. Existing Global API Key and email settings remain supported.
- Add a one-time API token migration notice for legacy-key users, with setup actions and a reminder to remove old credentials after testing a token.
- Replace the old preview and settings images with current screenshots of commands, Zone ID setup, secure token input, and the migration notice.
- Add a Test Connection command, clearer setup and permission errors, and status feedback for the configured zone and running actions.
- Fix background checks restarting after being disabled and prevent overlapping checks. Back off after failures without repeated notifications.
- Purge the cache automatically only after turning Development Mode on. Cancel pending purges when configuration changes, and keep each action tied to its original zone.
- Fix the Development Mode tooltip showing an invalid remaining time.
- Handle request timeouts, invalid responses, API failures, cancellation, and extension cleanup.
- Update development dependencies, remove unused tooling, restore tests, and add CI for supported VS Code versions and package validation.
- Add weekly dependency update checks and refresh setup documentation.

## **1.0.4**

- The README was referring to the wrong type of API Key, apologies for that! 🙏🏻

## **1.0.3**

- Security fixes (updated ESLint and its dependencies).

## **1.0.2**

- Set a 3s delay before clearing the cache automatically upon turning Development Mode on.
- Hovering over the cloud icon in the status bar will now show how many minutes are left before Development Mode will turn off automatically (Cloudflare turns it off automatically 3 hours after the last time you've enabled it).

## **1.0.1**

- Bug fixes

## **1.0.0**

- Initial release of Cloudflare DevTools
