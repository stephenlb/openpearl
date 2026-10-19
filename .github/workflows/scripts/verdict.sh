#!/usr/bin/env bash
# Usage: verdict.sh <file>; exits 0 only if the last non-blank line is exactly YES.
last=$(grep -v '^[[:space:]]*$' "$1" | tail -n 1 | tr -d '[:space:]')
[ "$last" = "YES" ]
