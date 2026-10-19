#!/usr/bin/env bash
# Usage: tenant-view.sh <src> <dst> <tenant>
# Copies the repository without .git, .github (the pipeline) or other tenants'
# extensions, so an agent working for one tenant can't read (and leak) another tenant's code.
set -euo pipefail
src=$1 dst=$2 tenant=$3
[[ "$tenant" =~ ^[a-z0-9][a-z0-9-]{1,38}$ ]] || { echo "invalid tenant: $tenant" >&2; exit 1; }
mkdir -p "$dst"
tar -C "$src" --exclude=./.git --exclude=./.github --exclude='./tenants/*' -cf - . | tar -C "$dst" -xf -
mkdir -p "$dst/tenants"
[ ! -f "$src/tenants/README.md" ] || cp "$src/tenants/README.md" "$dst/tenants/"
[ ! -d "$src/tenants/$tenant" ] || cp -R "$src/tenants/$tenant" "$dst/tenants/"
