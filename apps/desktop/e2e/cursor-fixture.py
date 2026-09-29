import json
import os
import sys

sid = os.environ.get("OPENADE_SESSION_ID", "fixture")
home = os.environ["OPENADE_PROVIDER_HOME"]
events = os.path.join(home, "cursor-events")
os.makedirs(events, exist_ok=True)
log = os.path.join(events, sid + ".jsonl")
agent_id = "cursor-" + sid
model = "auto"
turn = 0


def emit(frame):
    print(json.dumps(frame), flush=True)


def record(frame):
    with open(log, "a", encoding="utf8") as output:
        output.write(json.dumps(frame) + "\n")


if len(sys.argv) > 1 and sys.argv[1] == "models":
    emit({"ev": "models", "items": [
        {"id": "default", "displayName": "Auto"},
        {"id": "auto-smart", "displayName": "Auto", "parameters": [{"id": "optimize_for", "values": [{"value": "balanced"}]}]},
        {"id": "cursor-pro", "displayName": "Cursor Pro", "description": "Synthetic Cursor model"},
    ]})
    sys.exit(0)


def complete(prompt):
    global turn
    turn += 1
    if "fail-cursor-auth" in prompt:
        emit({"ev": "fatal", "message": "Cursor SDK is not connected; set CURSOR_API_KEY."})
        sys.exit(1)
    if "wait-cursor" in prompt:
        return
    emit({"ev": "thinking", "text": "Checking the workspace."})
    emit({"ev": "tool", "phase": "start", "id": "tool-" + str(turn), "name": "read", "args": {"path": "README.md"}})
    emit({"ev": "tool", "phase": "end", "id": "tool-" + str(turn), "name": "read", "args": {"path": "README.md"}, "error": False})
    emit({"ev": "text", "text": "Cursor SDK fixture: " + prompt})
    emit({"ev": "usage", "input": 24, "output": 7})
    emit({"ev": "turn", "status": "finished"})


for line in sys.stdin:
    try:
        command = json.loads(line)
    except json.JSONDecodeError:
        continue
    record(command)
    if command.get("op") == "run":
        if command.get("resume") not in (None, "", agent_id):
            emit({"ev": "fatal", "message": "Cursor resume identity changed"})
            break
        model = command.get("model") or "auto"
        emit({"ev": "ready", "agentId": agent_id, "model": model})
        complete(command.get("prompt", ""))
    elif command.get("op") == "user":
        complete(command.get("prompt", ""))
    elif command.get("op") == "interrupt":
        emit({"ev": "turn", "status": "cancelled"})
