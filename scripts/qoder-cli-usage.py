#!/usr/bin/env python3
"""Read Qoder plan/credit usage from the official CLI /usage panel.

The CLI only exposes usage in its interactive TUI, so this helper drives it
through a PTY and prints a small JSON document. It never reads Qoder's auth
files; the CLI owns that session.
"""

import datetime as dt
import json
import os
import re
import subprocess
import sys
import time

import pexpect

CLI = os.environ.get("QODER_CLI_PATH", os.path.expanduser("~/.local/bin/qodercli"))
HOME = os.path.expanduser("~")
ENV = {
    "HOME": HOME,
    "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
    "TERM": "xterm-256color",
    "LANG": "C.UTF-8",
    "USER": os.environ.get("USER", ""),
    "SHELL": "/bin/bash",
}

ANSI = re.compile(r"\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07]*\x07|[()][A-Z0-9]|[=>])")


def strip_ansi(text: str) -> str:
    text = ANSI.sub("", text).replace("\r", "")
    return "".join(ch if ch in "\n\t" or ord(ch) >= 32 else "" for ch in text)


def fail(message: str) -> None:
    print(json.dumps({"error": message}))
    sys.exit(1)


def number(value: str) -> float:
    return float(value.replace(",", ""))


def expiry(value: str) -> str | None:
    value = value.strip()
    if not value or value.upper() == "N/A" or value in {"—", "-"}:
        return None
    for fmt in ("%Y-%m-%d", "%b %d, %Y", "%B %d, %Y", "%m/%d/%Y"):
        try:
            parsed = dt.datetime.strptime(value, fmt)
            return parsed.replace(tzinfo=dt.timezone.utc).isoformat().replace("+00:00", "Z")
        except ValueError:
            continue
    return None


def parse_panel(text: str) -> dict:
    plan = re.search(r"Qoder\s*Plan\s*:\s*([^\n]+)", text)
    credits = re.search(
        r"Plan\s*Credits\s*Used\s*:\s*([0-9,]+(?:\.[0-9]+)?)\s*/\s*([0-9,]+(?:\.[0-9]+)?)",
        text,
    )
    if not plan or not credits:
        fail("Could not read the Qoder usage panel")

    add_on = re.search(r"Add-on\s*Credits\s*Used\s*:\s*([^\n]+)", text)
    add_on_value = add_on.group(1).strip() if add_on else "N/A"
    add_on_credits = None
    if re.match(r"^[0-9]", add_on_value):
        pair = re.match(r"([0-9,]+(?:\.[0-9]+)?)\s*/\s*([0-9,]+(?:\.[0-9]+)?)", add_on_value)
        if pair:
            add_on_credits = {"used": number(pair.group(1)), "total": number(pair.group(2))}

    expires = re.search(r"Plan\s*Expires\s*At\s*:\s*([^\n]+)", text)

    return {
        "plan": plan.group(1).strip(),
        "planCredits": {
            "used": number(credits.group(1)),
            "total": number(credits.group(2)),
        },
        "addOnCredits": add_on_credits,
        "expiresAt": expiry(expires.group(1)) if expires else None,
    }


def main() -> None:
    try:
        status = subprocess.run(
            [CLI, "status", "--output", "json"],
            env=ENV,
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        logged_in = json.loads(status.stdout or "{}").get("logged_in")
    except Exception as error:  # noqa: BLE001 - CLI errors are reported as JSON.
        fail(f"Qoder CLI check failed: {error}")
    if not logged_in:
        fail("Qoder CLI is not signed in; run 'qodercli login' on this machine")

    try:
        child = pexpect.spawn(
            CLI,
            [],
            env=ENV,
            cwd=HOME,
            encoding="utf-8",
            codec_errors="replace",
            dimensions=(45, 140),
            timeout=0.5,
        )
    except Exception as error:  # noqa: BLE001
        fail(f"Could not start the Qoder CLI: {error}")

    buffer = ""

    def read_for(seconds: float) -> None:
        nonlocal buffer
        end = time.time() + seconds
        while time.time() < end:
            try:
                chunk = child.read_nonblocking(size=65536, timeout=0.2)
                if chunk:
                    buffer += chunk
            except pexpect.TIMEOUT:
                continue
            except pexpect.EOF:
                break

    try:
        # The TUI paints its prompt before the account handshake finishes.
        read_for(15)
        screen = strip_ansi(buffer)
        if not re.search(r"Type\s*your\s*message", screen) and "for shortcuts" not in screen:
            read_for(5)

        child.send("\x15")
        time.sleep(0.2)
        child.send("/usage")
        time.sleep(0.3)
        child.send("\r")

        deadline = time.time() + 12
        panel = ""
        while time.time() < deadline:
            read_for(0.5)
            screen = strip_ansi(buffer)
            if re.search(r"Qoder\s*Plan\s*:", screen) and re.search(
                r"Plan\s*Credits\s*Used\s*:", screen
            ):
                panel = screen
                break
        if not panel:
            fail("Timed out waiting for the Qoder usage panel")
    finally:
        try:
            child.send("\x1b")
            time.sleep(0.2)
            child.sendcontrol("c")
            time.sleep(0.2)
            child.sendcontrol("c")
        except Exception:  # noqa: BLE001
            pass
        child.close(force=True)

    print(json.dumps(parse_panel(panel)))


if __name__ == "__main__":
    main()
