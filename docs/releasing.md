# Releasing

How a version of visual[flow] goes out: the branches, the tags, and the three update
channels people install from. `.github/workflows/release.yml` does the building (signed,
notarised, with the update bundle when the updater's key is set); this page is what you
do around it. The decision is entry 55 in
[#105](https://github.com/openflowfm/visuals/issues/105).

## The three channels

Which channel an app follows is fixed when it is built (`VISUALS_CHANNEL`, which
`release.yml` sets; `app/src-tauri/src/updater.rs` reads it). An app never changes channel
by updating, except a beta app updating to a final, which is a stable app.

| Channel | Built from | Download | Updates to |
| --- | --- | --- | --- |
| **stable** | each final tag, `vX.Y.Z`, once its draft is published | the disk image on [the latest release](https://github.com/openflowfm/visuals/releases/latest) | the next published final; never a release candidate |
| **beta** | each release candidate tag, `vX.Y.Z-rc.N`, once its draft is published | [visual-flow-beta_aarch64.dmg](https://github.com/openflowfm/visuals/releases/download/beta/visual-flow-beta_aarch64.dmg), always the newest candidate | the next candidate, then the final (`1.0.0-rc.2` → `1.0.0-rc.3` → `1.0.0`) |
| **latest** | every push to `main` | [visual-flow-latest_aarch64.dmg](https://github.com/openflowfm/visuals/releases/download/latest/visual-flow-latest_aarch64.dmg) | the next build from `main`, by build number |

- **stable** reads `releases/latest/download/latest.json`: the `latest.json` on GitHub's
  latest release, which is never a prerelease, so it never shows a candidate.
- **beta** reads the `latest.json` on the fixed `beta` prerelease. Publishing a
  candidate's draft puts its disk image there (renamed, so the link never changes) and
  its `latest.json`; publishing a final's draft puts only its `latest.json` there, so
  testers roll onto the final without reinstalling. The `beta` image stays the newest
  candidate. The feed never goes back: publishing `v1.0.2` after `v1.1.0-rc.1` leaves
  `beta` on the candidate.
- **latest** reads the `latest.json` on the fixed `latest` prerelease. Every build from
  `main` has the version in `tauri.conf.json`, so its `latest.json` says
  `<version>-latest.<build>` and a later build number is newer. A push to `main` cancels
  a latest build still running, so the last push always gets a build. Tag builds are
  never cancelled.

A run by hand (Actions → release → Run workflow, on any branch) builds a stable app and
keeps it on the run page as a build artifact, with no release.

## What testers install

- **People using it**: stable. The disk image from the latest release; it updates itself
  to each final.
- **Testers of a coming release**: beta. The `beta` disk image; it updates to each
  candidate and then to the final. After the final they are on stable, and to test the
  next release they install the `beta` image again once its first candidate is out.
- **Anyone following `main`**: latest. The `latest` disk image; it updates to each build
  from `main`, untested beyond building.

Open the disk image and drag visual[flow] to Applications. Each channel's app replaces
any other, since they are the same app.

## Branches

- `main` is the trunk. Everything lands there first, by PR; there is no develop branch.
- At the first release candidate of a minor version, cut `release/<major>.<minor>` from
  `main` (`release/1.0` for `1.0.0-rc.1`). `main` then moves on to the next minor's
  version (`1.1.0` in `tauri.conf.json`), so latest builds are newer than anything on the
  release branch.
- A fix merges to `main` first, then is cherry-picked onto the release branch with
  `git cherry-pick -x <commit>` (the `-x` notes where it came from), in a PR to the
  release branch.
- A fix that applies only to the release branch (a version bump, or code `main` no longer
  has) is its own PR to the release branch.
- Release branches are never merged back into `main`.
- Patch releases (`v1.0.1`) are tags on the same branch; `v1.1.0` gets `release/1.1`.

## Tagging a release candidate

1. On the release branch, set `version` in `app/src-tauri/tauri.conf.json` to the
   candidate (`1.0.0-rc.1`), by PR. The tag and this version must agree, or the build
   stops in its first fifteen seconds.
2. Optionally write `.github/notes/v1.0.0-rc.1.md`: the draft's notes and the update's
   notes in the app. Without it the draft's notes are generated from the PRs.
3. Tag the merged commit and push the tag:
   `git tag v1.0.0-rc.1 origin/release/1.0 && git push origin v1.0.0-rc.1`.
4. `release.yml` builds a beta app and opens a draft prerelease for the tag with its disk
   image, update bundle and `latest.json`.
5. Publish the draft (below). Beta apps hear of it, and the `beta` image is now this
   candidate.

The next candidate is the same with `rc.2`.

## Tagging a final

The same as a candidate with the plain version: `1.0.0` in `tauri.conf.json`, then
`git tag v1.0.0 origin/release/1.0 && git push origin v1.0.0`. `release.yml` builds a
stable app and opens a draft release (not a prerelease).

## Publishing a draft

On [the releases page](https://github.com/openflowfm/visuals/releases), open the draft,
read the notes one last time, and press **Publish release**. For a final, leave "Set as
the latest release" ticked, unless it is a patch to an older release (a `v1.0.2` after
`v1.1.0` is out), which must not become the latest. Publishing is what lets it out:

- a final becomes the latest release, which stable apps read and every install
  instruction points at;
- either one runs `release.yml` again (the `beta` job), which feeds the `beta`
  prerelease as described above. Its update bundle downloads only once the release is
  published, which is why the beta is fed on publishing rather than on building.

Nothing reaches an app until a draft is published. Deleting a draft instead leaves every
channel as it was; delete its tag too before tagging that version again.
