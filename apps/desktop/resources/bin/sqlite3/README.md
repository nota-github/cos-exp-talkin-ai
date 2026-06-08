Bundled SQLite launcher for `story-1.3`.

- Launcher path: `resources/bin/sqlite3/darwin/sqlite3-launcher`
- Runtime target on the current macOS baseline: `/usr/bin/sqlite3`
- Purpose: provide a repo-managed SQLite adapter for the Electron 30 desktop process without relying on a host `PATH` lookup

If a later packaging story relocates binaries, update `resolveBundledSqliteBinaryPath()` in `src/main/persistence/database.ts` accordingly.
