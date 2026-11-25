---
name: github-xray
description: Use when a developer asks for an X-ray, audit, cleanup or review of their own GitHub ("audit my GitHub", "clean up my GitHub profile", "what does a recruiter see on my GitHub", "leaked secrets in my repos", "is my GitHub profile outdated"). Interviews the dev, collects data via gh, audits the profile, repos and history security, scores each axis, and generates a reviewable apply.sh (dry-run by default) plus a plan for the next repos.
---

# GitHub X-ray

Runs an X-ray of the dev's personal GitHub account and delivers `xray/REPORT.md` + `xray/apply.sh`. Everything stays on the dev's machine: nothing is sent anywhere, and the `xray/` folder holds personal data (warn the dev not to commit it; suggest adding `xray/` to `.gitignore`).

Scripts live in `scripts/`, next to this file (Node 18+, no dependencies). Run them from the folder where the dev wants `xray/`. Requirements: authenticated `gh` (`gh auth status`), `git` and `bash` (Git Bash on Windows).

## Rules (learned the hard way)
- **Never delete a repo.** At most make it private or archive it, and only with the dev's approval. The generator refuses `delete`.
- **Never run `apply.sh --apply` on your own.** Show the dry-run; the dev reviews and runs it.
- **A public fork can't be made private**: only archive it (or the dev deletes it by hand).
- **Pinned repos can't be changed through the API**: list which ones to pin; the dev does it in Profile > Customize your pins.
- **Changing bio/profile needs the `user` scope on `gh`**, which opens a browser login: warn first.
- **Rewriting history does not clean closed PRs** (`refs/pull/*` keeps the old commit) and does not undo a leak: a leaked secret must be **revoked** first.
- **`git push` from a `--mirror` clone does not accept a refspec**: the script rewrites in a `--bare` clone made from the `--mirror` backup.
- Never show a full secret: the scripts already mask it (`AIza…(39 chars)`).

## Flow

### 1. Interview (one question at a time, wait for the answer)
1. Role and main stack?
2. Seniority (junior, mid, senior, lead)?
3. Where do you work now / what do you do day to day? (can skip)
4. Goal for GitHub: full-time job, freelance, content, open source? (can be more than one)
5. What **must not** be public? Paid product, client code, employer, project names, folders. Ask for names or pieces of names.

Write `xray/profile.md` (the answers) and `xray/private.txt` (one item from question 5 per line, lowercase, `#` for comments). Items match repo names and any already-committed file path.

### 2. Collection (read-only)
```bash
node <scripts>/collect.mjs        # -> xray/collect.json
```
Profile, bio, social links, repos (visibility, description, topics, README, last push, language, license, fork, archived), pinned repos and contributions. Use a browser only if the dev asks for a profile screenshot.

### 3. Trends for the role/level
Short web research (3-5 searches): what recruiters and the community expect to see on GitHub for the interview's role + level + stack, and 2-3 similar reference profiles (with links). Don't make things up: only what the source says.

### 4. Security audit
```bash
node <scripts>/history.mjs     # mirror-clones public repos into xray/clones/ -> xray/history.json
```
Searches the whole history (including PR refs) for: secrets (private key, AWS, GitHub, Google, Slack, Stripe, OpenAI, Anthropic, connection string, `password=`), sensitive files (`.env`, `.pem`, `id_rsa`...), items from `private.txt`, and AI co-author/signature on commits (`Co-authored-by` Claude/Copilot/Cursor..., "Generated with Claude Code"). CI bots (github-actions, dependabot) don't count. Warn that it can take a while on accounts with many repos.

### 5. Scored diagnosis
```bash
node <scripts>/audit.mjs     # -> xray/audit.json, xray/plan.json, xray/REPORT.md
```
Score 0-10 per axis: profile, showcase (pinned), public repo quality, security. It also flags old public study repos (no push in 2+ years and not in the showcase), repos without description/topics/README, empty bio, public forks.
Then **fill in REPORT.md** at each `<!-- fill in -->`: alignment score with the goal, trends, the 3-5 highest-impact changes, and the next-repos plan (3-5 rows, table Phase · Timeline · Repo · Why, based on role/level/stack). For a `suspected` finding, open the file in the clone and check before stating it as fact.

### 6. Apply script
Review `xray/plan.json` with the dev, one action at a time:
- remove what they don't want (e.g. an old study repo they like);
- fill `value` and delete `pending` on text actions (bio, description, topics). An action with `pending` is skipped;
- you can add actions: `private`, `archive`, `description`, `homepage`, `topics` (list), `profile` (`field`: bio, blog, name, company, location, hireable), `clean-coauthor`. Keep the old value in `previous` so undo works.
```bash
node <scripts>/apply.mjs       # -> xray/apply.sh
bash xray/apply.sh             # dry-run: shows each step's command and undo, changes nothing
```
Show the dry-run. The dev is the one who runs `bash xray/apply.sh --apply`. `clean-coauthor` makes a `--mirror` backup in `xray/backup/` before the force push.

## Delivery
Short reply: overall score, the 3 worst findings, what `apply.sh` does, what is manual (pinned repos, revoking secrets, deleting a fork) and the path to REPORT.md. At the end, remind: `xray/` has personal data and the clones can be deleted.
