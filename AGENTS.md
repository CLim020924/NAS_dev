# NAS Project Agent Rules

This repository is the live NAS service project. Treat it as a production-like
system even when making small UI changes.

## Project Identity

- Repository: `CLim020924/NAS_dev`
- Main working path on the NAS: `/home/limchanyoung/my-service-platform`
- Expected branch: `cleanup/git-tracking-2026-06-08`
- Normal SSH user: `limchanyoung`
- Do not use root-owned git configuration unless the user explicitly asks.

## Required Memory Check

Before changing code, configuration, deployment, network settings, or generated
project documents, say:

```text
프로젝트 메모리 확인하고 시작할게
```

Then actually check these files:

1. `AI_MUST_READ_PROJECT_RELAY.md`
2. `docs/NAS_PROJECT_MEMORY_POLICY.md`
3. `docs/NAS_PROJECT_LOG.xlsx`

`AI_MUST_READ_PROJECT_RELAY.md` is the human-readable continuity document for
new conversations. Keep it synchronized whenever authentication, storage
boundaries, networking, deployment, Office/HWP, Windows Agent, or CFAPI plans
change.

The workbook is the source of truth for prior fixes, feature dependencies, and
operational warnings. Do not rely on conversation memory alone.

## Encoding Safety Rule

Never create Korean workbook/document content through PowerShell inline strings,
here-strings, `echo`, or shell redirection. This previously corrupted every
sheet into `??`.

Use this safe process instead:

1. Put Korean content in a UTF-8 source file such as `.mjs`, `.py`, `.md`, or
   `.json`.
2. If collecting NAS data, create UTF-8 files on the NAS and transfer them with
   `scp`.
3. Generate the workbook from those UTF-8 files.
4. Reopen the generated workbook and scan all string cells for suspicious `??`,
   `????`, replacement characters, or mojibake before reporting completion.

If the scan fails, do not copy the workbook to `docs/` and do not claim it is
fixed.

## Workbook Sheets To Check

The current workbook uses these key sheets:

- `README`: purpose, generation basis, and top-level usage.
- `Memory_Process`: required workflow before and after changes.
- `Do_Not_Break`: fragile settings and regressions to avoid.
- `Feature_Index`: feature IDs and current status.
- `Relation_Map`: dependencies between features.
- `Code_Map`: code/config files mapped to features.
- `API_Routes`: backend route map from actual code.
- `Socket_Events`: socket event map from actual code.
- `Data_Files`: persisted JSON/data files.
- `Network_Config`: Cloudflare, tunnel, DNS, ports, and public settings.
- `Office_Viewers`: OnlyOffice/RHWP viewer and editor notes.
- `Patch_Log`: problem/request/cause/solution/verification/risk records.
- `Request_Archive`: original user requests.
- `Generated_Check`: workbook generation and verification details.

## How Much To Read

Do not read every project file by default. Use this layered process:

1. Always check `README`, `Memory_Process`, `Do_Not_Break`,
   `Feature_Index`, and `Relation_Map`.
2. Identify the related Feature IDs for the request.
3. Read the related topic sheets and code files from `Code_Map`.
4. Expand the read scope when `Relation_Map` or `Do_Not_Break` shows a risk.

Examples:

- Meeting work must also check chat, auth/session, notifications, network,
  media-state, and same-account multi-device rules when relevant.
- Office viewer work must check OnlyOffice/RHWP, Nginx routing, share-link
  viewer reuse, private-IP rules, browser save behavior, and mobile scrolling.
- Upload/share/file work must check storage quota, user root boundaries, upload
  domain, notification behavior, and shared-link viewer behavior.
- Network work must check Cloudflare, cloudflared processes, AdGuard, Nginx,
  router/NAT, Tailscale, public URLs, and upload domain behavior.

## Do Not Break

Never casually change these without checking the workbook first:

- Cloudflare DNS, Tunnel routing, proxy mode, or DNS-only mode
- `cloudflared` process ownership and duplicate tunnel instances
- AdGuard DNS/DHCP settings for internal home-network domain access
- Nginx `server_name`, `proxy_pass`, websocket, upload buffering, or HTTPS
  blocks
- OnlyOffice DocumentServer private/meta IP allowance
- user role checks for master/admin/normal accounts
- user root path boundaries for files, search, sharing, upload, quota, sync,
  and AI
- meeting/chat/notification room relationships
- session identity for same-account multi-device meetings

If a change touches one of these and cannot be tested, mark it as `확인 필요`
instead of `완료`.

## Before Editing

1. Run `git status --short --branch`.
2. Identify whether there are user changes. Do not overwrite or revert them.
3. Map the request to Feature IDs using `Feature_Index`.
4. Check dependencies in `Relation_Map`.
5. Check warnings in `Do_Not_Break`.
6. Read the narrowest relevant code files.

## After Editing

For every feature change, bug fix, config change, deployment change, or
operational diagnosis:

1. Add the user's original request to `Request_Archive`.
2. Add or update a `Patch_Log` row with:
   - original request text
   - date
   - status
   - symptom/request
   - cause/background
   - solution
   - verification
   - remaining risk
3. If a new feature area appears, add a Feature ID to `Feature_Index`.
4. If dependencies changed, update `Relation_Map`.
5. If a new operational safety rule appears, update `Do_Not_Break`.

## Per-Request Relay And Git Record

For every GPT/Codex user request in this repository, including questions,
diagnosis, implementation, verification, deployment, and interrupted work:

1. Append a sanitized entry to `AI_MUST_READ_PROJECT_RELAY.md` in the same task.
2. Record the date, the user's request summary, work performed, verification,
   unresolved items, and the next safe action.
3. Never copy passwords, API keys, pairing tokens, Agent tokens, session URLs,
   private keys, or other credentials into the relay, workbook, or Git history.
4. For implementation/fix/config tasks, also update `Request_Archive`,
   `Patch_Log`, and any related workbook sheets before completion.
5. When the user asks to save or upload the work, include the relay/workbook
   updates in the same Git commit as the related code whenever practical.
6. If a request is interrupted, record the exact completed boundary and mark
   remaining work as pending instead of claiming completion.

## Verification Rules

- Prefer actual tests over assumptions.
- If the NAS server is off or a browser/device condition cannot be reproduced,
  record `확인 필요`.
- For frontend changes, run at least a build or the smallest available check
  unless blocked.
- For backend changes, run a syntax check or service-level check when possible.
- For Nginx/system changes, use `nginx -t`, service status, and direct curl
  checks before reload/restart.

## Git Rules

- Do not run destructive git commands such as `git reset --hard` or
  `git checkout --` unless the user explicitly asks.
- Do not commit secrets, `.env`, API keys, tokens, generated logs, or private
  runtime state.
- Commit only after the user asks or when the current task explicitly includes
  saving work to Git.
