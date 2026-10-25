#!/usr/bin/env python3
"""Keep the Ledger (DESIGN.md) alive across agent threads.

  session-start  Hand a new thread the Ledger as it stands on trunk, plus how fresh it is.
  stop           When a thread changed the code but not the Ledger, ask once whether it is still true.
  check          Print the same health report for a human: ./.claude/hooks/ledger.py check

Wired up in .claude/settings.json. Every failure is silent: a broken hook must never block a thread.
"""
import hashlib, json, os, re, subprocess, sys, time

LEDGER = "DESIGN.md"
NOTES = ["DESIGN.md", "AGENTS.md", "README.md"]  # checked for references to files that are gone
LONG = 9000  # characters; past this the Ledger stops being a quick read
FETCH_EVERY = 600  # seconds between background fetches of trunk

ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()


QUIET = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o ConnectTimeout=4"}


def git(*args, ok=False):
    r = subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True, env=QUIET)
    if r.returncode and not ok:
        raise RuntimeError(r.stderr)
    return r.stdout.strip() if r.returncode == 0 else ""


def fetch():
    """Refresh origin/main now and then, so a thread sees what was merged on GitHub."""
    stamp = os.path.join(git("rev-parse", "--git-common-dir"), "FETCH_HEAD")
    stamp = stamp if os.path.isabs(stamp) else os.path.join(ROOT, stamp)
    try:
        if time.time() - os.path.getmtime(stamp) < FETCH_EVERY:
            return
    except OSError:
        pass
    try:
        subprocess.run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"], timeout=6, capture_output=True, env=QUIET)
    except subprocess.TimeoutExpired:
        pass


def trunk():
    """The newest of local main and origin/main."""
    have = [r for r in ("origin/main", "main") if git("rev-parse", "-q", "--verify", r, ok=True)]
    if len(have) == 2 and subprocess.run(["git", "-C", ROOT, "merge-base", "--is-ancestor", "origin/main", "main"]).returncode == 0:
        return "main"
    return have[0] if have else None


def changed_files(base):
    """Files this checkout changed since it left trunk: commits, staged, unstaged and new."""
    files = set()
    if base:
        files |= set(git("diff", "--name-only", base, "HEAD", ok=True).splitlines())
    files |= set(git("diff", "--name-only", "HEAD", ok=True).splitlines())
    files |= set(git("ls-files", "--others", "--exclude-standard", ok=True).splitlines())
    return {f for f in files if f}


def missing_refs():
    """`backticked/paths` in the notes that no longer exist in this checkout."""
    gone = []
    for note in NOTES:
        try:
            text = open(os.path.join(ROOT, note), encoding="utf-8").read()
        except OSError:
            continue
        for ref in sorted(set(re.findall(r"`([^`\s]+)`", text))):
            path = ref[2:] if ref.startswith("./") else ref
            looks_like_path = "/" in path or re.search(r"\.(ts|js|py|md|sh|json|toml|css|html)$", path)
            if looks_like_path and not path.startswith(("http", "~", "-")) and "*" not in path \
                    and not os.path.exists(os.path.join(ROOT, path)) \
                    and subprocess.run(["git", "-C", ROOT, "check-ignore", "-q", path]).returncode:
                gone.append(f"`{ref}` (in {note})")
    return gone


def health(t, base):
    """Short facts that tell a reader how far to trust the Ledger today."""
    lines = []
    if t:
        behind = git("rev-list", "--count", f"HEAD..{t}", ok=True)
        if behind and int(behind):
            log = "\n".join(f"  - {c}" for c in git("log", "--format=%h %s", "-8", f"HEAD..{t}", ok=True).splitlines())
            lines.append(f"This checkout is {behind} commit(s) behind `{t}`. Bring them in before building on it:\n{log}")
        last = git("log", "-1", "--format=%h", t, "--", LEDGER, ok=True)
        if last:
            since = git("log", "--format=%h", f"{last}..{t}", ok=True).split()
            if since:
                dirs = {}
                for f in git("diff", "--name-only", last, t, ok=True).splitlines():
                    if f != LEDGER:
                        d = "/".join(f.split("/")[:2]) if "/" in f else f
                        dirs[d] = dirs.get(d, 0) + 1
                top = ", ".join(f"{d} ({n})" for d, n in sorted(dirs.items(), key=lambda x: -x[1])[:6])
                lines.append(f"Trunk has {len(since)} commit(s) since the Ledger was last edited ({last}). "
                             f"They touched: {top}. Pages about those areas may lag behind the code.")
    gone = missing_refs()
    if gone:
        lines.append("The notes mention files that don't exist here: " + ", ".join(gone) + ". Fix or drop them.")
    size = len(ledger_text(t, base))
    if size > LONG:
        lines.append(f"The Ledger is {size} characters. Past ~{LONG} it stops being a quick read: tighten it.")
    return lines


def ledger_text(t, base):
    """Trunk's Ledger, unless this branch already rewrote it."""
    if t and LEDGER not in changed_files(base):
        text = git("show", f"{t}:{LEDGER}", ok=True)
        if text:
            return text
    try:
        return open(os.path.join(ROOT, LEDGER), encoding="utf-8").read()
    except OSError:
        return ""


def session_start(event):
    fetch()
    t = trunk()
    base = git("merge-base", "HEAD", t, ok=True) if t else ""
    remember_start(event, base)
    notes = health(t, base)
    if event.get("source") == "resume":
        body = ""  # the conversation already has the Ledger
    else:
        text = ledger_text(t, base)
        if not text:
            return
        body = (f"# The Ledger: this project's memory\n\n"
                f"Below is `{LEDGER}` as it stands on trunk. It is the story of this project: what we're "
                f"building, why, what we tried and dropped, and what we learned from watching Krishna play. "
                f"Let it shape your taste and decisions. Where it disagrees with the code or with what "
                f"Krishna tells you, the live thing wins, and you fix the page.\n\n"
                f"When you finish work, leave the Ledger a little truer: rewrite any page your work made "
                f"untrue, and write down decisions, dead ends and playtest lessons a future thread would "
                f"want. Current state only, in the Ledger's own voice; git keeps the history.\n\n"
                f"<ledger>\n{text}\n</ledger>\n")
    if notes:
        body += "\n## How fresh the memory is\n\n" + "\n".join(f"- {n}" for n in notes) + "\n"
    if body:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": body}}))


def state_path(event):
    """Per-thread notes, kept in this worktree's git dir so they never show up as changes."""
    d = git("rev-parse", "--git-dir")
    d = os.path.join(d if os.path.isabs(d) else os.path.join(ROOT, d), "ledger")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, re.sub(r"[^\w-]", "_", event.get("session_id") or "none") + ".json")


def fingerprints(files):
    out = {}
    for f in files:
        try:
            out[f] = hashlib.sha1(open(os.path.join(ROOT, f), "rb").read()).hexdigest()
        except OSError:
            out[f] = "gone"
    return out


def remember_start(event, base):
    """Snapshot what was already changed when the thread started, so only its own work counts."""
    path = state_path(event)
    if not os.path.exists(path):
        json.dump({"start": fingerprints(changed_files(base)), "asked": []}, open(path, "w"))


def stop(event):
    if event.get("stop_hook_active"):
        return
    t = trunk()
    base = git("merge-base", "HEAD", t, ok=True) if t else ""
    path = state_path(event)
    state = json.load(open(path)) if os.path.exists(path) else {"start": {}, "asked": []}
    now = fingerprints(changed_files(base))
    touched = {f for f, h in now.items() if state["start"].get(f) != h}
    if LEDGER in touched:
        return  # this thread already tended the Ledger
    # ask once, and again only if the thread goes on to touch other files
    new = touched - set(state["asked"])
    if not new:
        return
    state["asked"] = sorted(touched | set(state["asked"]))
    json.dump(state, open(path, "w"))
    work = sorted(touched)
    shown = ", ".join(work[:12]) + (f" and {len(work) - 12} more" if len(work) > 12 else "")
    gone = missing_refs()
    reason = (f"Before you hand back: does the Ledger (`{LEDGER}`) still tell the truth? "
              f"This thread changed {shown}, and the Ledger hasn't been touched.\n\n"
              f"- If a page is now wrong, or this work produced something a future thread should know "
              f"(a decision and its why, an idea tried and dropped, something Krishna said or did while "
              f"playing), rewrite that page in place, in the Ledger's voice. Current state only. Keep the "
              f"edit with the work, in the same commit or PR.\n"
              f"- If the Ledger is still true, say so in one line and finish.")
    if gone:
        reason += "\n\nAlso: the notes mention files that don't exist here: " + ", ".join(gone) + "."
    print(json.dumps({"decision": "block", "reason": reason}))


def check():
    fetch()
    t = trunk()
    base = git("merge-base", "HEAD", t, ok=True) if t else ""
    notes = health(t, base)
    print(f"Ledger: {LEDGER} on {t or 'no trunk'}, {len(ledger_text(t, base))} characters")
    print("\n".join(f"- {n}" for n in notes) if notes else "- Fresh: nothing to report.")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "check"
    if mode == "check":
        check()
        sys.exit()
    try:
        {"session-start": session_start, "stop": stop}[mode](json.load(sys.stdin))
    except Exception as e:  # never block a thread because the memory hook broke
        print(f"ledger hook: {e}", file=sys.stderr)
