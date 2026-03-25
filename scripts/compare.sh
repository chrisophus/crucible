#!/usr/bin/env bash
set -euo pipefail

MODES=(formal input narrative hybrid sketch summary)
MODEL=""
PROVIDER=""
PURIFY_MODEL=""
FILES=()

usage() {
  echo "Usage: $0 [--model <model>] [--provider <provider>] [--purify-model <model>] [file ...]"
  exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      [[ $# -lt 2 ]] && usage
      MODEL="$2"; shift 2 ;;
    --provider)
      [[ $# -lt 2 ]] && usage
      PROVIDER="$2"; shift 2 ;;
    --purify-model)
      [[ $# -lt 2 ]] && usage
      PURIFY_MODEL="$2"; shift 2 ;;
    --help|-h)
      usage ;;
    -*)
      echo "Unknown flag: $1" >&2; usage ;;
    *)
      FILES+=("$1"); shift ;;
  esac
done

# Default to all examples
if [[ ${#FILES[@]} -eq 0 ]]; then
  while IFS= read -r -d '' f; do
    FILES+=("$f")
  done < <(find examples -maxdepth 1 -name '*.md' -print0 | sort -z)
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No input files found." >&2
  exit 1
fi

mkdir -p output

# Build common purify flags
EXTRA_FLAGS=()
[[ -n "$MODEL" ]]        && EXTRA_FLAGS+=(--model "$MODEL")
[[ -n "$PROVIDER" ]]     && EXTRA_FLAGS+=(--provider "$PROVIDER")
[[ -n "$PURIFY_MODEL" ]] && EXTRA_FLAGS+=(--purify-model "$PURIFY_MODEL")

for file in "${FILES[@]}"; do
  basename="${file##*/}"
  name="${basename%.md}"
  outdir="output/$name"
  mkdir -p "$outdir"

  first=true
  for mode in "${MODES[@]}"; do
    printf "[%s] [%s] " "$name" "$mode"

    cmd=(purify -f "$file" --mode "$mode" --output "$outdir/$mode.md" "${EXTRA_FLAGS[@]}")

    if [[ "$first" == true ]]; then
      cmd+=(--save-aisp "$outdir/$name.aisp")
      first=false
    fi

    "${cmd[@]}"
    echo "done"
  done
done
