#!/usr/bin/env bash
# Refresh the network-evidence snapshot in one command (task PA-004).
#
# Fetches the live indexer endpoints behind lilyshark.vercel.app, pins the
# result as analysis/fixtures/shelby_network_snapshot.json, regenerates
# analysis/results_evidence.md + analysis/chart_blob_sizes.svg with the new
# date stamp, and republishes the docs set into webapp/public/docs/.
#
# Requires network access, deliberately: a "refresh" that reads the pinned
# fixture would stamp today's date on stale numbers. Offline, this script
# fails loudly instead.
#
# Shelbynet is an Early Access prototype chain that is wiped roughly weekly
# (see docs/strategy/2026-q3-direction.md §3), so refreshed numbers can be
# *smaller* than the previous snapshot. That is expected, not an error —
# the evidence is scale-of-testnet and only honest while dated.

set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Fetching live network evidence and pinning the snapshot..."
if ! python3 analysis/shelby_network_evidence.py --save-snapshot; then
    cat >&2 <<'EOF'

refresh_evidence.sh: FAILED — could not fetch the live indexer.

No files were re-dated. If you are offline, regenerate the report from the
existing pinned snapshot (it keeps its original date stamp) with:

    python3 analysis/shelby_network_evidence.py --offline

and re-run this script when you have connectivity.
EOF
    exit 1
fi

echo "==> Republishing docs to webapp/public/docs/..."
python3 scripts/sync_docs_to_webapp.py

echo "==> Done. New snapshot date:"
grep -m1 '^Snapshot:' analysis/results_evidence.md
cat <<'EOF'

Review the diff before committing:
  analysis/fixtures/shelby_network_snapshot.json   (the pinned raw data)
  analysis/results_evidence.md                      (report, new date stamp)
  analysis/chart_blob_sizes.svg                     (chart, new date stamp)
  webapp/public/docs/**                             (published copies)

Then update any prose that quotes the headline numbers — each quote must
carry the new snapshot date (see "Refreshing the snapshot" in
analysis/README.md, and task PA-003 for the single-source rule).
EOF
