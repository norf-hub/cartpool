# Running npm install & npm test — a step-by-step walkthrough

Written for Windows PowerShell. Do **Part 1** first; it's quick and fixes the
CI problem. **Part 2** (the tests) needs Docker and takes longer.

Throughout: to run a command, type it (or copy-paste it) into PowerShell and
press **Enter**. To open PowerShell, press the **Windows key**, type
`powershell`, and click **Windows PowerShell**.

---

## Part 1 — `npm install` (fixes CI, no database needed)

### 1a. Check that Node.js is installed

```powershell
node --version
```

- If you see a version like `v20.11.0`, you're set — skip to 1b.
- If you see *"node is not recognized"*, install it first: go to
  <https://nodejs.org>, download the **LTS** version, run the installer with
  all the default options, then **close and reopen PowerShell** and try
  `node --version` again.

### 1b. Go to the project folder and install

```powershell
cd C:\dev\cartpool
npm install
```

Run this from `C:\dev\cartpool` (the top of the project), **not** from inside
the `app` or `tests` folders — this project is set up so one install at the
top covers everything. It takes a minute or two the first time. Some yellow
`WARN` lines are normal; you're only in trouble if it says `ERR`.

### 1c. If it mentions esbuild / blocked scripts

Newer npm blocks one build step by default. If the output mentions `esbuild`
or a "blocked"/"ignored" build script, run these two lines:

```powershell
npm approve-scripts esbuild
npm rebuild esbuild
```

If it didn't mention esbuild, skip this.

### 1d. Confirm the lockfile updated, then commit it

The whole point of this part is to refresh `package-lock.json` so the
automated CI check stops failing. Check that it changed:

```powershell
git status
```

You want to see `package-lock.json` in the list of modified files. If it's
there, save it:

```powershell
git add package-lock.json
git commit -m "Update package-lock for the new font packages"
```

If `git status` says nothing changed, the lockfile was already current —
that's fine, nothing to commit. **Part 1 done.**

---

## Part 2 — `npm test` (needs Postgres, via Docker)

The tests run against a real Postgres database, and on Windows that means
Docker Desktop either way. There are two routes:

- **2b — the project's own Supabase stack.** Recommended. `npm test` then works
  with no extra typing, because the default database address in
  `tests/helpers/db.ts` already points at it. Same stack the app uses for local
  development (`docs/LOCAL-DEV.md`).
- **2d — a standalone Postgres container.** A fallback if you don't want the
  whole stack running. Slightly more to type, and easy to get wrong.

### 2a. Install Docker Desktop (one time)

1. Go to <https://www.docker.com/products/docker-desktop/> and download
   **Docker Desktop for Windows**.
2. Run the installer with the default options. It may ask to restart your PC —
   let it.
3. After restarting, open **Docker Desktop** from the Start menu. Wait until
   the little whale icon near the clock is steady (not animating) and the app
   says **"Engine running"**. First launch can take a couple of minutes.

Leave Docker Desktop running for the rest of Part 2.

### 2b. Start the local Supabase stack

This needs the Supabase CLI. Check:

```powershell
supabase --version
```

If that prints a version (2.x), you're set. If it's not recognised, install it
with [scoop](https://scoop.sh):

```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

Other install options are at
<https://supabase.com/docs/guides/local-development/cli/getting-started>.

Then, with Docker Desktop running:

```powershell
cd C:\dev\cartpool
supabase start
```

First run downloads a dozen container images — several minutes, once. It
finishes by printing a table of URLs and keys; the `DB URL` line should read
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`. A couple of
`WARN: no SMS provider is enabled` lines are expected and harmless.

### 2c. Run the tests

Still at `C:\dev\cartpool`:

```powershell
npm test
```

That's all — no database address to set, because the default in
`tests/helpers/db.ts` already points at port 54322.

The tests use their own `cartpool_test` database on that stack, created
automatically, so they never touch the app data sitting in the same Postgres.
You'll see a list of test files. At the end you want **"Test Files"** and
**"Tests"** both reporting all passed, with no failures.

To shut the stack down when you're done: `supabase stop`. That keeps the local
database in a Docker volume; add `--no-backup` only if you want it discarded.

### 2d. Alternative — a standalone Postgres container

Skip this if 2b worked. If you'd rather not run the whole stack:

```powershell
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17
```

The first time, Docker downloads Postgres (a short wait). When it prints a long
string of letters/numbers and returns you to the prompt, the database is running
in the background. Then point the tests at it:

```powershell
cd C:\dev\cartpool
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5432/postgres"
npm test
```

> ⚠️ That middle line is the Windows PowerShell way to set the database
> address. The project's README shows a Mac/Linux version
> (`DATABASE_URL=... npm test`) that will **not** work in PowerShell — use the
> two-line version above. It also only lasts for that one PowerShell window: open
> a new one and you have to set it again, or you'll get `ECONNREFUSED`.

On this route the tests build their schema directly in the container's
`postgres` database, dropping and rebuilding it each run. That's fine in a
throwaway container — never aim `DATABASE_URL` at a database whose contents you
care about.

### 2e. When you're done — clean up (optional)

For 2b: `supabase stop`. For 2d:

```powershell
docker ps            # shows running containers; copy the CONTAINER ID
docker stop <paste-the-id-here>
```

Docker Desktop can also be quit entirely when you're not testing.

---

## If something goes wrong

- **"npm is not recognized"** → Node isn't installed or PowerShell wasn't
  reopened after installing it. Redo step 1a.
- **"docker is not recognized"** → Docker Desktop isn't installed, or isn't
  finished starting. Make sure the whale icon shows "Engine running", then
  reopen PowerShell.
- **Tests fail to connect / "ECONNREFUSED"** → usually the database isn't
  running: redo step 2b, then 2c. On the 2d route, check that
  `$env:DATABASE_URL` is set in *this* PowerShell window. But read the next
  entry before assuming either — a *running, healthy* database can still be
  unreachable.
- **"ECONNREFUSED" while the container is up and healthy** → Windows may have
  reserved the port, in which case Docker fails to publish it **silently**.
  Find your database container and check whether its port really is published:

  ```powershell
  docker ps
  docker port <paste-the-container-id-here>
  ```

  You want a line mapping the port to the host: `5432/tcp -> 0.0.0.0:54322` for
  the stack from step 2b (its container is named `supabase_db_cartpool`), or
  `-> 0.0.0.0:5432` for the standalone container from 2d. **If it prints
  nothing**, the port was never published. Confirm why:

  ```powershell
  netsh interface ipv4 show excludedportrange protocol=tcp
  ```

  If a listed range covers your port, Windows has claimed it. (It grabs
  100-port blocks in the 54xxx space; in July 2026 one of them swallowed
  54321-54323, which broke the `supabase start` route completely while leaving
  every container healthy.) Free it in an **Administrator** PowerShell —
  substitute your own port for `54321` — then fully quit and reopen Docker
  Desktop:

  ```powershell
  net stop winnat
  netsh int ipv4 add excludedportrange protocol=tcp startport=54321 numberofports=3 store=persistent
  net start winnat
  ```

  Restarting the container does **not** help. On the `supabase start` route,
  finish with `supabase stop` then `supabase start` — and don't `docker restart`
  its database container by itself; doing that got it killed (exit 137).
- **"Test Files no tests"** alongside any of the above → not a separate
  problem. The database setup in `tests/helpers/setup.ts` runs before Vitest
  collects anything, so when it throws, zero test files are reported. Fix the
  connection and the tests reappear.
- **A test actually fails** (red, with an error message) → copy the failing
  test's name and the error text back to me and I'll help you read it.
