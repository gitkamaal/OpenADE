import json
import os
import sys
import threading
import time

sid = os.environ.get("OPENADE_SESSION_ID", "fixture")
agent = os.path.basename(sys.argv[0])
provider_session = "acp-" + sid
home = os.environ["OPENADE_PROVIDER_HOME"]
log_dir = os.path.join(home, "acp-events")
os.makedirs(log_dir, exist_ok=True)
log_path = os.path.join(log_dir, sid + ".jsonl")
write_lock = threading.Lock()
cancelled = threading.Event()
permission_reply = threading.Event()
permission_choice = [""]
current_model = ["grok-auto" if agent == "grok" else "devin-default"]
current_effort = ["low"]


def config_options():
    return [
        {"id": "model-choice", "name": "Model", "type": "select", "category": "model", "currentValue": current_model[0], "options": [{"value": "devin-default", "name": "Devin Default"}, {"value": "devin-pro", "name": "Devin Pro"}]},
        {"id": "thought-level", "name": "Reasoning", "type": "select", "category": "thought_level", "currentValue": current_effort[0], "options": [{"value": "low", "name": "Low"}, {"value": "high", "name": "High"}]},
        {"id": "fast-mode", "name": "Fast mode", "type": "boolean", "category": "model_config", "currentValue": False},
    ]


def session_result():
    if agent == "grok":
        return {"sessionId": provider_session, "models": {"currentModelId": current_model[0], "availableModels": [{"modelId": "grok-auto", "name": "Grok Auto"}, {"modelId": "grok-pro", "name": "Grok Pro", "description": "Synthetic advanced model"}]}}
    if agent == "devin":
        return {"sessionId": provider_session, "configOptions": config_options()}
    return {"sessionId": provider_session}


def emit(value):
    with write_lock:
        sys.stdout.write(json.dumps({"jsonrpc": "2.0", **value}) + "\n")
        sys.stdout.flush()


def record(value):
    with open(log_path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(value) + "\n")


def update(kind, **fields):
    emit({"method": "session/update", "params": {"sessionId": provider_session, "update": {"sessionUpdate": kind, **fields}}})


def prompt_turn(request_id, params):
    text = "".join(block.get("text", "") for block in params.get("prompt", []) if block.get("type") == "text")
    record({"prompt": text, "sessionId": params.get("sessionId"), "promptId": params.get("_meta", {}).get("promptId"), "model": current_model[0], "effort": current_effort[0]})
    emit({"method": "session/update", "params": {"sessionId": "wrong-session", "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "WRONG SESSION"}}}})
    update("agent_thought_chunk", content={"type": "text", "text": "thinking"})
    if "ask-permission" in text:
        emit({"id": "permission-1", "method": "session/request_permission", "params": {"sessionId": provider_session, "toolCall": {"title": "May I read the project?"}, "options": [{"optionId": "allow-once", "name": "Allow once", "kind": "allow_once"}, {"optionId": "deny-once", "name": "Deny", "kind": "reject_once"}]}})
        permission_reply.wait(10)
        update("tool_call", toolCallId="fixture-tool", title="Permission result", status="pending")
        update("tool_call_update", toolCallId="fixture-tool", title="Permission result", status=permission_choice[0] or "missing")
    if "wait-cancel" in text:
        cancelled.wait(10)
        emit({"id": request_id, "result": {"stopReason": "cancelled" if cancelled.is_set() else "error"}})
        return
    for chunk in ("ACP ", "native ", "chat ", "works."):
        update("agent_message_chunk", content={"type": "text", "text": chunk})
        time.sleep(0.02)
    if "context-fresh-fallback" in text:
        gate = os.path.join(home, "acp-fallback-context-" + sid)
        open(gate + ".ready", "w").close()
        deadline = time.monotonic() + 10
        while not os.path.exists(gate + ".go") and time.monotonic() < deadline:
            time.sleep(0.02)
    update("usage_update", used=80, contextWindow=128)
    if "grok-extension" in text:
        emit({"method": "_x.ai/session/prompt_complete", "params": {"sessionId": provider_session, "promptId": params.get("_meta", {}).get("promptId"), "stopReason": "end_turn"}})
        return
    emit({"id": request_id, "result": {"stopReason": "end_turn", "usage": {"inputTokens": 5, "outputTokens": 3}}})


for line in sys.stdin:
    try:
        frame = json.loads(line)
    except json.JSONDecodeError:
        continue
    record({"method": frame.get("method"), "params": frame.get("params"), "result": frame.get("result")})
    method = frame.get("method")
    request_id = frame.get("id")
    if method == "initialize":
        emit({"id": request_id, "result": {"protocolVersion": 1, "agentInfo": {"name": "fixture-acp"}, "agentCapabilities": {"loadSession": True}}})
    elif method == "session/new":
        emit({"id": request_id, "result": session_result()})
    elif method == "session/load":
        if os.environ.get("OPENADE_ACP_FAIL_LOAD") == "1" or frame.get("params", {}).get("sessionId") != provider_session:
            emit({"id": request_id, "error": {"code": -32602, "message": "unknown session"}})
        else:
            emit({"id": request_id, "result": session_result()})
    elif method == "session/set_model":
        wanted = frame.get("params", {}).get("modelId")
        if agent == "grok" and wanted in ("grok-auto", "grok-pro"):
            current_model[0] = wanted
            emit({"id": request_id, "result": {"models": session_result()["models"]}})
        else:
            emit({"id": request_id, "error": {"code": -32602, "message": "unsupported model"}})
    elif method == "session/set_config_option":
        params = frame.get("params", {})
        config_id, wanted = params.get("configId"), params.get("value")
        if agent != "devin":
            emit({"id": request_id, "error": {"code": -32601, "message": "unsupported config"}})
        elif config_id == "model-choice" and wanted in ("devin-default", "devin-pro"):
            current_model[0] = wanted
            update("config_option_update", configOptions=config_options())
            emit({"id": request_id, "result": {"configOptions": config_options()}})
        elif config_id == "thought-level" and wanted in ("low", "high"):
            current_effort[0] = wanted
            emit({"id": request_id, "result": {"configOptions": config_options()}})
        else:
            emit({"id": request_id, "error": {"code": -32602, "message": "unsupported config choice"}})
    elif method == "session/prompt":
        cancelled.clear()
        threading.Thread(target=prompt_turn, args=(request_id, frame.get("params", {})), daemon=True).start()
    elif method == "session/cancel":
        cancelled.set()
    elif request_id == "permission-1" and method is None:
        permission_choice[0] = frame.get("result", {}).get("outcome", {}).get("optionId", "")
        permission_reply.set()
