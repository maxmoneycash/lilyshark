#!/usr/bin/env bash
# Render the documentation diagrams from their sources in docs/diagrams/.
#
# The renderer is Archify (MIT, https://github.com/tt-a1i/archify). It is NOT
# vendored: the tool is 7 MB of someone else's code that changes on their
# schedule, while the part that is ours -- the typed JSON describing what
# Lilyshark actually is -- is a few kilobytes and belongs under review. So the
# sources live in the repo, the renderer is fetched on demand into a cache,
# and the rendered HTML is committed so a reader never needs either.
#
# Usage:
#   scripts/build_diagrams.sh            # render every diagram
#   scripts/build_diagrams.sh --check    # validate only, render nothing
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${script_dir}/.." && pwd)"
src_dir="${repo_dir}/docs/diagrams"
out_dir="${repo_dir}/webapp/public/docs/diagrams"
cache_dir="${HOME}/.cache/lilyshark/archify"
archify_repo="https://github.com/tt-a1i/archify.git"

check_only=0
case "${1:-}" in
    "") ;;
    --check) check_only=1 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "build_diagrams.sh: unknown argument '$1'" >&2; exit 2 ;;
esac

fail() { echo "" >&2; echo "ERROR: $*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "node is required to render diagrams."
command -v git >/dev/null 2>&1 || fail "git is required to fetch the renderer."

# Fetched once and reused. Pinned by nothing today, which is a deliberate
# limitation worth stating rather than hiding: a renderer change can alter the
# committed HTML without any source changing. The committed output is what a
# reader sees, so a surprising diff here means the tool moved, not the system.
if [ ! -d "${cache_dir}/.git" ]; then
    echo "==> Fetching Archify (once, into ${cache_dir})"
    mkdir -p "$(dirname "${cache_dir}")"
    git clone -q --depth 1 "${archify_repo}" "${cache_dir}" \
        || fail "could not fetch Archify from ${archify_repo}"
fi

archify="${cache_dir}/archify/bin/archify.mjs"
[ -f "${archify}" ] || fail "Archify is in ${cache_dir} but has no bin/archify.mjs.
  Delete that directory and re-run to fetch it again."

shopt -s nullglob
sources=("${src_dir}"/*.json)
[ ${#sources[@]} -gt 0 ] || fail "no diagram sources in ${src_dir}"

mkdir -p "${out_dir}"
failures=0

for source in "${sources[@]}"; do
    base="$(basename "${source}")"
    # "lilyshark.architecture.json" -> type "architecture", stem "lilyshark"
    stem="${base%%.*}"
    rest="${base#*.}"
    type="${rest%%.*}"
    output="${out_dir}/${stem}-${type}.html"

    echo "==> ${base}  (${type})"
    if ! node "${archify}" validate "${type}" "${source}" >/dev/null 2>&1; then
        echo "    INVALID -- the details:" >&2
        node "${archify}" validate "${type}" "${source}" 2>&1 | sed 's/^/    /' >&2
        failures=$((failures + 1))
        continue
    fi
    echo "    valid"

    [ ${check_only} -eq 1 ] && continue

    node "${archify}" render "${type}" "${source}" "${output}" --repo-root "${repo_dir}" >/dev/null \
        || { echo "    render failed" >&2; failures=$((failures + 1)); continue; }

    # The renderer can emit a file that does not stand up on its own; check it
    # rather than trusting that a zero exit means a readable diagram.
    if ! node "${archify}" check "${output}" 2>/dev/null | grep -q '"ok": *true'; then
        echo "    rendered, but the artifact check did not pass" >&2
        failures=$((failures + 1))
        continue
    fi
    echo "    rendered  ${output#"${repo_dir}/"}"
done

if [ ${failures} -gt 0 ]; then
    fail "${failures} diagram(s) did not build"
fi

echo ""
echo "All diagrams built."
