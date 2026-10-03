# Releasing to npm with Buildkite

Releases of `@kenzuya/honest-better-auth` are started by hand from the Buildkite UI. The build shows a form where you pick
the version, then `.buildkite/scripts/release.sh` runs Biome, the type check and the tests, bumps `package.json`, commits
`chore(release): vX.Y.Z`, tags `vX.Y.Z`, pushes both to `master`, builds and runs `npm publish`.

The steps live in `.buildkite/pipeline.yml`, the file `buildkite-agent pipeline upload` reads when it gets no path, so the
pipeline settings in Buildkite stay at the default upload step.

## One-time setup

1. **npm token.** On npmjs.com, create a granular access token with read and write access to the `@kenzuya` scope (or
   all packages for the first publish), with "bypass 2FA" enabled. The npm account must own the `@kenzuya` scope (user
   or organization `kenzuya`).
2. **GitHub token.** Create a fine-grained personal access token for `kenzuya/honestjs-better-auth` with **Contents: Read
   and write**. If `master` is protected, allow this token's user to bypass the rule, otherwise the release commit push
   is rejected.
3. **Buildkite secrets.** In the cluster that runs the pipeline, go to _Secrets_ and add `NPM_TOKEN` and
   `GITHUB_PUSH_TOKEN`. The release step loads them through the `secrets` attribute, and Buildkite redacts them from
   logs. If the cluster already has them for `@kenzuya/honest`, they can be shared when the GitHub token also covers this
   repository.
4. **Pipeline.** Create a pipeline for `https://github.com/kenzuya/honestjs-better-auth` in a cluster with a hosted Linux
   queue, and keep its steps at the default:

    ```yaml
    steps:
        - label: ':pipeline: Pipeline upload'
          command: buildkite-agent pipeline upload
    ```

    If the hosted queue is not the cluster's default queue, add `agents: { queue: <key> }` to this step and uncomment
    the `agents` block in `pipeline.yml`.

5. **Triggers.** In the pipeline's GitHub settings, turn off building on push and on pull requests. Builds not started
   from the UI skip the release steps anyway.

## Releasing

1. Open the pipeline and click **New Build**, choose branch `master`, then **Create Build**.
2. Click the **Release @kenzuya/honest-better-auth** step and fill in the form:

    | Field         | Meaning                                                                                        |
    | ------------- | ---------------------------------------------------------------------------------------------- |
    | Version bump  | `patch`, `minor`, `major`, `prepatch`, `preminor`, `premajor` or `prerelease`                  |
    | Exact version | Optional, overrides the bump (for example `1.0.0` to publish the current version as is)        |
    | Prerelease id | Suffix for the `pre*` bumps, for example `beta` gives `1.0.1-beta.0`                           |
    | npm dist-tag  | `auto` uses `latest` for stable versions and `next` for prereleases                            |
    | Mode          | `dry-run` runs everything up to `npm publish --dry-run` without pushing; `publish` releases it |

3. Run a `dry-run` first and check the annotation, then start another build with `publish`.

`publish` only runs on the pipeline's default branch. Other branches can use `dry-run`.

### First release (1.0.0)

`package.json` is already at `1.0.0`. Set **Exact version** to `1.0.0`: the version does not change, so no release
commit is made, and the build tags `v1.0.0` and publishes it. Leaving the field empty would bump to `1.0.1`.

## When something fails

- **Push rejected:** `master` moved after the build started. Start a new build so it picks up the latest commit.
- **Publish failed after the push:** retry the `:npm: Release` job. It finds the pushed tag, checks it out and publishes
  from it without bumping again.
- **Version already on npm:** a `publish` build stops with a warning and changes nothing. Pick another version.

## Running the script locally

The script only needs `buildkite-agent` for `meta-data get` and `annotate`. A stub on `PATH` is enough for a local dry
run:

```bash
mkdir -p /tmp/bk && cat > /tmp/bk/buildkite-agent <<'STUB'
#!/usr/bin/env bash
case "$1 $2" in
  "meta-data get") key="${3//-/_}"; printf '%s' "${!key:-$5}" ;;
  "annotate "*) cat ;;
esac
STUB
chmod +x /tmp/bk/buildkite-agent
PATH="/tmp/bk:$PATH" BUILDKITE_BRANCH=master release_mode=dry-run release_version=1.0.0 bash .buildkite/scripts/release.sh
git checkout package.json
```
