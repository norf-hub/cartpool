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

The tests run against a real Postgres database. The simplest way to get one on
Windows is Docker Desktop.

### 2a. Install Docker Desktop (one time)

1. Go to <https://www.docker.com/products/docker-desktop/> and download
   **Docker Desktop for Windows**.
2. Run the installer with the default options. It may ask to restart your PC —
   let it.
3. After restarting, open **Docker Desktop** from the Start menu. Wait until
   the little whale icon near the clock is steady (not animating) and the app
   says **"Engine running"**. First launch can take a couple of minutes.

Leave Docker Desktop running for the rest of Part 2.

### 2b. Start a Postgres database

In PowerShell:

```powershell
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15
```

The first time, Docker downloads Postgres (a short wait). When it prints a
long string of letters/numbers and returns you to the prompt, the database is
running in the background.

### 2c. Run the tests

Still in PowerShell, at `C:\dev\cartpool`:

```powershell
cd C:\dev\cartpool
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5432/postgres"
npm test
```

> ⚠️ That middle line is the Windows PowerShell way to set the database
> address. The project's README shows a Mac/Linux version
> (`DATABASE_URL=... npm test`) that will **not** work in PowerShell — use the
> two-line version above.

You'll see a long list of test names. At the end you want something like
**"Test Files X passed"** with no failures. The new `cross-group.test.ts`
should be among them.

### 2d. When you're done — clean up (optional)

To stop the database container later:

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
- **Tests fail to connect / "ECONNREFUSED"** → the Postgres container isn't
  running. Redo step 2b, then 2c.
- **A test actually fails** (red, with an error message) → copy the failing
  test's name and the error text back to me and I'll help you read it.
