# GitHub X-Ray: a Claude Code skill

**English** | [Português (BR)](README.pt-BR.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Node 18+](https://img.shields.io/badge/node-18%2B-green.svg)](https://nodejs.org) [![GitHub stars](https://img.shields.io/github/stars/CorreaJhow/raio-x-github?style=social)](https://github.com/CorreaJhow/raio-x-github)

A [Claude Code](https://code.claude.com) skill that audits your own GitHub account: profile, repos and **the security of your full commit history**. It scores each axis and generates a script you can review before anything changes.

**Nothing leaves your machine, and nothing changes until you run the script yourself.**

## What it does
1. **Short interview**, one question at a time: role, level, goal (job, freelance, content, open source) and what **must never be public**.
2. **Read-only collection** with `gh`: profile, bio, repos, READMEs, topics, pinned repos, contributions.
3. **Trends** for your role and level, with reference profiles.
4. **Security audit** of the whole history of your public repos, including closed PR refs:
   - committed secrets (AWS, GitHub, Google, OpenAI, Anthropic, Stripe keys, private keys, connection strings...);
   - files from paid products or clients in public repos (from your own list);
   - AI co-author trailers in commits (`Co-authored-by: Claude...`, Copilot, Cursor);
   - public forks (they can't be made private) and old commits stuck in closed PRs.
5. **Score from 0 to 10** for profile, pinned repos, repo quality, security and fit with your goal.
6. **`apply.sh`**: dry-run by default, runs only with `--apply`, shows how to undo each step, makes a `--mirror` backup before rewriting history and **never deletes a repo**. Plus a plan for your next 3-5 repos.

## Requirements
Claude Code, [`gh`](https://cli.github.com) authenticated (`gh auth login`), `git`, Node 18+ and `bash` (on Windows, Git Bash).

## Installation
```text
/plugin marketplace add CorreaJhow/raio-x-github
/plugin install raio-x-github@raio-x-github
```
This installs two skills: `github-xray` (English) and `raio-x-github` (Portuguese).

Manual install of the English skill:
```bash
git clone https://github.com/CorreaJhow/raio-x-github.git
cp -r raio-x-github/skills/raio-x-github-en ~/.claude/skills/github-xray
```

## Usage
In any folder, ask Claude: *"audit my GitHub"*, *"what does a recruiter see on my GitHub?"* or *"are there leaked secrets in my repos?"*, then answer the interview. Output goes to `xray/`.

> Add `xray/` to your `.gitignore`: it contains data from your account.

## Example output
```text
$ node scripts/audit.mjs
ok  scores {"profile":7,"pins":4.7,"quality":6.2,"security":4,"fit":null} · 14 findings · 6 proposed actions
```

`xray/REPORT.md` (excerpt):

| Severity | Axis | Where | What |
|---|---|---|---|
| high | security | portfolio | Item from your "must not be public" list (paid-course) in a public repo (e.g. paid-course/lesson1.md). |
| medium | security | shop-api | 12 commit(s) with an unwanted co-author trailer (e.g. co-author: Claude <noreply@anthropic.com>). |
| medium | quality | FirstCrud | No push in 4.0 years and not pinned: old study repo? Candidate for private. |

`bash xray/apply.sh` (dry-run):
```text
DRY RUN: nothing will be changed. Use --apply to execute.

== 1. private portfolio: contains "paid-course"
  command:  gh repo edit dev/portfolio --visibility private --accept-visibility-change-consequences
  undo:     gh repo edit dev/portfolio --visibility public --accept-visibility-change-consequences
```

## Scripts
In `skills/raio-x-github-en/scripts/`, no dependencies:

| Script | Does | Writes |
|---|---|---|
| `collect.mjs` | reads the account via `gh` | `xray/collect.json` |
| `history.mjs` | clones public repos and scans history | `xray/history.json` |
| `audit.mjs` | scores, findings and plan | `audit.json`, `plan.json`, `REPORT.md` |
| `apply.mjs` | builds the script from the reviewed plan | `xray/apply.sh` |

Tests: `node --test skills/raio-x-github-en/scripts/test.mjs`

## Safety rules
- Never deletes a repo: at most private or archived, with your approval.
- Never runs `apply.sh --apply` on its own: you review the dry-run and run it.
- Rewriting history does not clean closed PRs and does not undo a leak: **revoke a leaked secret first**.
- Secrets are masked in all output (`AIza…(39 chars)`).

## Out of scope (v1)
Designed profile READMEs (it only suggests text), GitLab/Bitbucket, organizations.

## License
MIT. See [LICENSE](LICENSE).
