#!/usr/bin/env bash
# Scenario checks for ledger.py, in a scratch repo under /tmp: ./.claude/hooks/test_ledger.sh
set -euo pipefail
HOOK=$(realpath "$(dirname "$0")/ledger.py")
S=$(mktemp -d); trap 'rm -rf "$S"' EXIT
fails=0
ok() { echo "ok   $1"; }
no() { echo "FAIL $1"; fails=$((fails + 1)); }
run() { (cd "$W" && CLAUDE_PROJECT_DIR="$W" python3 "$HOOK" "$@"); }
start() { echo "{\"session_id\":\"$1\",\"source\":\"${2:-startup}\"}" | run session-start; }
stop() { echo "{\"session_id\":\"$1\"}" | run stop; }

git init -q -b main "$S/seed" && cd "$S/seed"
mkdir -p server tools && echo "rules" > server/rules.ts && echo "sim" > tools/sim.ts
printf '# Ledger\n\n## Page 1\nSpore Pouch grows mushrooms. See `tools/sim.ts` and `server/rules.ts`. Ratio `3/4`.\n' > DESIGN.md
git add -A && git commit -qm seed
git clone -q --bare . "$S/origin.git" && git clone -q "$S/origin.git" "$S/main" && cd "$S/main"
git worktree add -q -b t3/old "$S/old" HEAD

# trunk moves on GitHub only: a Ledger edit, then code
echo "Draws cost a life." >> DESIGN.md && git commit -qam "Draws cost a life"
echo more >> server/rules.ts && git commit -qam "Tweak rules" && git push -q origin main
git reset -q --hard HEAD~2  # local main lags origin/main

W=$S/old
out=$(start a)
[[ $out == *"Draws cost a life"* ]] && ok "stale worktree gets trunk's Ledger from origin/main" || no "trunk Ledger injected"
[[ $out == *"2 commit(s) behind"* ]] && ok "says how far behind it is" || no "behind note"
[[ $out == *"since the Ledger was last edited"* && $out == *"server/rules.ts (1)"* ]] && ok "says what changed since the Ledger" || no "drift note"
[[ $out != *'`3/4` (in'* ]] && ok "no false alarm for \`3/4\`" || no "3/4 flagged"

[[ -z $(stop a) ]] && ok "no nudge without work" || no "nudged without work"
echo x >> "$W/tools/sim.ts"
[[ $(stop a) == *'"decision": "block"'* ]] && ok "nudges after a code change" || no "no nudge after change"
echo y >> "$W/tools/sim.ts"
[[ -z $(stop a) ]] && ok "doesn't nag again for the same file" || no "nagged twice"
echo z >> "$W/server/rules.ts"
[[ $(stop a) == *"server/rules.ts"* ]] && ok "asks again when other files are touched" || no "no re-ask"
[[ -z $(echo '{"session_id":"a","stop_hook_active":true}' | run stop) ]] && ok "never loops" || no "loop guard"

start b >/dev/null
[[ -z $(stop b) ]] && ok "work from before the thread started doesn't count" || no "pre-existing work counted"
echo q >> "$W/server/rules.ts"; echo "Pouch is now a Satchel." >> "$W/DESIGN.md"
[[ -z $(stop b) ]] && ok "no nudge when the thread tended the Ledger" || no "nudged despite Ledger edit"

[[ -z $(stop c) ]] && ok "a thread with no start snapshot starts counting now" || no "missing state"

out=$(start d)
[[ $out == *"Pouch is now a Satchel"* ]] && ok "a branch that rewrote the Ledger sees its own copy" || no "own copy"
[[ $out == *"Both this branch and"* ]] && ok "warns when trunk's Ledger moved under it" || no "divergence warning"
again=$(start d resume)
[[ $again != *"<ledger>"* && $again != *"behind"* ]] && ok "resume doesn't repeat itself" || no "resume repeats"

rm "$W/tools/sim.ts"
[[ $(cd "$W" && CLAUDE_PROJECT_DIR="$W" python3 "$HOOK" check) == *'`tools/sim.ts`'* ]] && ok "flags notes about deleted files" || no "missing ref"

mkdir "$S/plain" && W=$S/plain && echo "# Ledger" > "$W/DESIGN.md"
[[ $(start e) == *"# Ledger"* && -z $(stop e) ]] && ok "outside git: still hands over the Ledger" || no "no git"

echo; [ $fails -eq 0 ] && echo "all good" || { echo "$fails failed"; exit 1; }
