# Releasing

How a version of visual[flow] goes out: the branches, the tags, and the two update
channels apps follow. `.github/workflows/release.yml` does the building (signed,
notarised, with the update bundle when the updater's key is set); this page is what you
do around it. The decision is entry 55 in
[#105](https://github.com/openflowfm/visuals/issues/105).

## The two channels

The app follows the channel chosen in Settings, kept in `updates.json` in
`~/.openflow/visuals` (`app/src-tauri/src/updater.rs`; the commands are `update_channel`
and `update_channel_set`). Until a choice is made it follows the one it was built for:
`latest` for a build from `main`, `release` for a tag's build (`VISUALS_CHANNEL`, which
`release.yml` sets). Switching never goes back a version: an app moves on when the other
channel has something newer than what it runs.

| Channel | Built from | Download | Its manifest |
| --- | --- | --- | --- |
| **release** | each final tag, `vX.Y.Z`, once its draft is published | the disk image on [the latest release](https://github.com/openflowfm/visuals/releases/latest) | [`releases/latest/download/latest.json`](https://github.com/openflowfm/visuals/releases/latest/download/latest.json) |
| **latest** | every signed build from a push to `main` | [visual-flow-latest_aarch64.dmg](https://github.com/openflowfm/visuals/releases/download/latest/visual-flow-latest_aarch64.dmg) | [`releases/download/latest/latest.json`](https://github.com/openflowfm/visuals/releases/download/latest/latest.json) |

Both manifests are Tauri updater `latest.json` files (version, notes, date, and per
platform the update bundle's URL and signature) kept as GitHub Release assets, at URLs
that never change:

- **release** reads the `latest.json` on GitHub's latest release. GitHub never makes a
  draft or a prerelease the latest release, so it moves only when a final's draft is
  published, and never shows a release candidate. Its version is the tag's (`1.0.0`).
- **latest** reads the `latest.json` on the fixed `latest` prerelease (never GitHub's
  latest release). Every build from `main` has the version in `tauri.conf.json`, so its
  `latest.json` says `<version>-latest.<run number>` (`0.3.0-latest.412`). The app
  compares these itself (semver would order `0.3.0-latest.412` before `0.3.0`): later
  numbers win, and with the same numbers the later build, against the run number the
  running app was built with. Every build of `release.yml`, tags included, takes its
  number from the same run counter, so a release app switched to latest takes the next
  build from `main` and no earlier one. A push to `main` cancels a latest build still
  running, so the last push always gets a build; a run older than the live
  `latest.json`'s publishes nothing, so the channel never goes back. The bundle the live
  `latest.json` names and the two before it stay on the prerelease.

A release candidate tag, `vX.Y.Z-rc.N`, builds the same app and opens a draft
prerelease: testers download its disk image from the releases page. No channel reads a
prerelease, so once a tester's candidate is installed it follows `release` (the final
of its version is newer) unless they choose `latest`.

A run by hand (Actions → release → Run workflow, on any branch) builds a release app and
keeps it on the run page as a build artifact, with no release.

## Setting up update signing (once)

Updates are signed with their own key (not the Apple certificate) and the app checks
that signature with the public key in `app/src-tauri/tauri.conf.json`. Until both are
set, every build still builds, without update bundles or `latest.json`, and the app says
"Updates aren't set up in this build".

1. Make the key pair, with a password: `npx @tauri-apps/cli@2.9.6 signer generate -w ~/.tauri/visual-flow-updater.key`
   (or `cargo tauri signer generate -w …` with the tauri-cli `release.yml` installs; this
   repo has no `tauri` npm script, and the bare `npx tauri` package is not Tauri's CLI).
   Keep `~/.tauri/visual-flow-updater.key` and its password safe; losing them means
   no installed app can take another update.
2. Put the private key and its password in the repository's secrets:
   `gh secret set TAURI_SIGNING_PRIVATE_KEY --repo openflowfm/visuals < ~/.tauri/visual-flow-updater.key`
   and `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo openflowfm/visuals` (it
   asks for the password).
3. Paste the whole of `~/.tauri/visual-flow-updater.key.pub` (one line) as
   `plugins.updater.pubkey` in `app/src-tauri/tauri.conf.json`, in place of
   `REPLACE_WITH_CONTENTS_OF_visual-flow-updater.key.pub`, by PR. With the secret set and
   the placeholder still there, `release.yml` stops in its first job and says so.

Apps built before the key was in `tauri.conf.json` can't update themselves; install the
next build by hand once.

## Branches

- `main` is the trunk. Everything lands there first, by PR; there is no develop branch.
- At the first release candidate of a minor version (or at its final, without one), cut
  `release/<major>.<minor>` from `main` (`release/1.0` for `1.0.0`). `main` then moves on
  to the next minor's version (`1.1.0` in `tauri.conf.json`), so latest builds are newer
  than anything on the release branch.
- A fix merges to `main` first, then is cherry-picked onto the release branch with
  `git cherry-pick -x <commit>` (the `-x` notes where it came from), in a PR to the
  release branch.
- A fix that applies only to the release branch (a version bump, or code `main` no longer
  has) is its own PR to the release branch.
- Release branches are never merged back into `main`.
- Patch releases (`v1.0.1`) are tags on the same branch; `v1.1.0` gets `release/1.1`.

## Cutting a release

1. On the release branch, set `version` in `app/src-tauri/tauri.conf.json` to the
   release (`1.0.0`), by PR. The tag and this version must agree, or the build stops in
   its first fifteen seconds.
2. Optionally write `.github/notes/v1.0.0.md`: the draft's notes and the update's notes
   in the app. Without it the draft's notes are generated from the PRs.
3. Tag the merged commit and push the tag:
   `git tag v1.0.0 origin/release/1.0 && git push origin v1.0.0`.
4. `release.yml` builds the app and opens a draft release for the tag with its disk
   image, update bundle and `latest.json`.
5. Publish the draft (below). Release apps hear of it.

A release candidate is the same with `1.0.0-rc.1` and the tag `v1.0.0-rc.1`; its draft
is a prerelease, and publishing it puts it on the releases page for testers without
touching either channel.

## Publishing a draft

On [the releases page](https://github.com/openflowfm/visuals/releases), open the draft,
read the notes one last time, and press **Publish release**. For a final, leave "Set as
the latest release" ticked, unless it is a patch to an older release (a `v1.0.2` after
`v1.1.0` is out), which must not become the latest: the latest release is what release
apps read and every install instruction points at.

Nothing reaches an app until a draft is published. Deleting a draft instead leaves every
channel as it was; delete its tag too before tagging that version again.
