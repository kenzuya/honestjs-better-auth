#!/usr/bin/env bash
# Publishes the package to npm. Run by .buildkite/pipeline.yml after the release input step is submitted.
#
# Flow: verify (lint, format, types, tests) -> bump version -> commit + tag + push -> build -> npm publish.
# The push happens before the publish because npm versions are immutable. If the publish fails, retrying the job
# finds the pushed tag and resumes from it instead of bumping again.
set -euo pipefail

meta() {
	buildkite-agent meta-data get "$1" --default "${2:-}"
}

annotate() {
	local style="$1" body="$2"
	printf '%s\n' "$body" | buildkite-agent annotate --style "$style" --context release
}

fail() {
	echo "^^^ +++"
	echo ":x: $*" >&2
	annotate error "**Release failed:** $*"
	exit 1
}

json_field() {
	node -p "require('./package.json').$1"
}

install_bun() {
	# Defaults to the Bun version in package.json's packageManager, which wrote bun.lock.
	local version="${BUN_VERSION:-$(node -p "(require('./package.json').packageManager || '').split('@')[1] || ''")}"
	if command -v curl >/dev/null && command -v unzip >/dev/null; then
		curl -fsSL https://bun.sh/install | bash -s ${version:+"bun-v$version"}
		export PATH="$HOME/.bun/bin:$PATH"
	else
		npm install --prefix "$HOME/.bun-npm" --no-save --no-audit --no-fund "bun${version:+@$version}"
		export PATH="$HOME/.bun-npm/node_modules/.bin:$PATH"
	fi
}

echo "--- :buildkite: Release options"
BUMP="$(meta release-bump patch)"
EXACT_VERSION="$(meta release-version)"
EXACT_VERSION="${EXACT_VERSION#v}"
PREID="$(meta release-preid beta)"
DIST_TAG="$(meta release-dist-tag auto)"
MODE="$(meta release-mode dry-run)"
BRANCH="${BUILDKITE_BRANCH:?BUILDKITE_BRANCH is not set}"
DEFAULT_BRANCH="${BUILDKITE_PIPELINE_DEFAULT_BRANCH:-master}"

echo "bump=${BUMP} exact=${EXACT_VERSION:-<none>} preid=${PREID:-<none>} dist-tag=${DIST_TAG} mode=${MODE}"
echo "branch=${BRANCH} commit=${BUILDKITE_COMMIT:-$(git rev-parse HEAD)}"

case "$MODE" in
	dry-run | publish) ;;
	*) fail "Unknown release mode '${MODE}'." ;;
esac

if [[ "$MODE" == "publish" && "$BRANCH" != "$DEFAULT_BRANCH" ]]; then
	fail "Publishing is only allowed from '${DEFAULT_BRANCH}' (this build is on '${BRANCH}'). Use dry-run on other branches."
fi

echo "--- :hammer_and_wrench: Tooling"
for tool in git node npm; do
	command -v "$tool" >/dev/null || fail "'${tool}' is not installed on this agent."
done
command -v bun >/dev/null || install_bun
echo "node $(node --version), npm $(npm --version), bun $(bun --version)"

# The repository .npmrc reads the registry token from NODE_AUTH_TOKEN.
export NODE_AUTH_TOKEN="${NPM_TOKEN:-}"

echo "--- :bun: Install"
bun install --frozen-lockfile

echo "--- :biome: Lint and format"
bun run check

echo "--- :typescript: Type check"
bun run typecheck

echo "--- :test_tube: Test"
bun run test

echo "--- :label: Version"
PACKAGE_NAME="$(json_field name)"
CURRENT_VERSION="$(json_field version)"
version_args=("${EXACT_VERSION:-$BUMP}" --no-git-tag-version --allow-same-version)
if [[ -z "$EXACT_VERSION" && -n "$PREID" ]]; then
	version_args+=(--preid "$PREID")
fi
npm version "${version_args[@]}" >/dev/null || fail "npm version ${version_args[*]} failed."
VERSION="$(json_field version)"
TAG="v${VERSION}"

if [[ "$DIST_TAG" == "auto" ]]; then
	if [[ "$VERSION" == *-* ]]; then DIST_TAG="next"; else DIST_TAG="latest"; fi
fi
if [[ "$VERSION" == *-* && "$DIST_TAG" == "latest" ]]; then
	fail "Prerelease ${VERSION} must not be published to the 'latest' dist-tag."
fi
echo "${PACKAGE_NAME}: ${CURRENT_VERSION} -> ${VERSION} (dist-tag: ${DIST_TAG})"

if [[ -n "$(npm view "${PACKAGE_NAME}@${VERSION}" version 2>/dev/null || true)" ]]; then
	if [[ "$MODE" == "publish" ]]; then
		annotate warning "\`${PACKAGE_NAME}@${VERSION}\` is already on npm. Nothing to publish."
		exit 0
	fi
	fail "${PACKAGE_NAME}@${VERSION} is already on npm. Pick another version."
fi

if [[ "$MODE" == "dry-run" ]]; then
	echo "--- :package: Build"
	bun run build

	echo "+++ :npm: npm publish --dry-run"
	git --no-pager diff -- package.json
	npm publish --dry-run --tag "$DIST_TAG"

	annotate info "Dry run OK: would publish \`${PACKAGE_NAME}@${VERSION}\` with dist-tag \`${DIST_TAG}\` and push tag \`${TAG}\` to \`${BRANCH}\`."
	exit 0
fi

echo "--- :key: Credentials"
[[ -n "${NPM_TOKEN:-}" ]] || fail "NPM_TOKEN is empty. Add it as a Buildkite secret."
[[ -n "${GITHUB_PUSH_TOKEN:-}" ]] || fail "GITHUB_PUSH_TOKEN is empty. Add it as a Buildkite secret."
NPM_USER="$(npm whoami)" || fail "npm whoami failed. Check NPM_TOKEN."
echo "npm user: ${NPM_USER}"

REPO_SLUG="${RELEASE_REPO_SLUG:-$(sed -E 's#^(git@github\.com:|ssh://git@github\.com/|https://github\.com/)##; s#\.git$##' <<<"${BUILDKITE_REPO:-}")}"
[[ "$REPO_SLUG" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] ||
	fail "Could not derive a GitHub owner/repo from BUILDKITE_REPO='${BUILDKITE_REPO:-}'. Set RELEASE_REPO_SLUG."
PUSH_URL="https://x-access-token:${GITHUB_PUSH_TOKEN}@github.com/${REPO_SLUG}.git"

echo "--- :git: Commit and tag ${TAG}"
export GIT_AUTHOR_NAME="${BUILDKITE_BUILD_CREATOR:-Buildkite Release}"
export GIT_AUTHOR_EMAIL="${BUILDKITE_BUILD_CREATOR_EMAIL:-buildkite-release@users.noreply.github.com}"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

if git ls-remote --exit-code --tags "$PUSH_URL" "refs/tags/${TAG}" >/dev/null; then
	echo "Tag ${TAG} already exists on GitHub, resuming the publish from it."
	git fetch --no-tags "$PUSH_URL" "+refs/tags/${TAG}:refs/tags/${TAG}"
	git checkout --force "$TAG"
	[[ "$(json_field version)" == "$VERSION" ]] || fail "Tag ${TAG} does not contain version ${VERSION} in package.json."
else
	git checkout -B "$BRANCH"
	if ! git diff --quiet -- package.json; then
		git commit --no-verify -m "chore(release): ${TAG}" -- package.json
	fi
	git tag -a "$TAG" -m "$TAG"
	git push --atomic --no-verify "$PUSH_URL" "HEAD:refs/heads/${BRANCH}" "refs/tags/${TAG}" ||
		fail "Pushing ${TAG} to ${BRANCH} failed. Has ${BRANCH} moved since this build started? Start a new build."
fi

echo "--- :package: Build"
bun run build

echo "+++ :npm: Publish ${PACKAGE_NAME}@${VERSION}"
npm publish --tag "$DIST_TAG"

annotate success "Published [\`${PACKAGE_NAME}@${VERSION}\`](https://www.npmjs.com/package/${PACKAGE_NAME}/v/${VERSION}) with dist-tag \`${DIST_TAG}\` and pushed tag \`${TAG}\`."
