const frontendEnv = (import.meta as ImportMeta & {
  env?: { VITE_OPENADE_DAEMON_URL?: string; VITE_OPENADE_AUTH_TOKEN?: string };
}).env;

export let DAEMON_URL = frontendEnv?.VITE_OPENADE_DAEMON_URL ?? "http://127.0.0.1:7433";

let authToken=frontendEnv?.VITE_OPENADE_AUTH_TOKEN ?? "";
let connectionPromise:Promise<void>|null=null;
function bounded<T>(promise:Promise<T>, milliseconds:number, message:string):Promise<T>{
 return new Promise((resolve,reject)=>{const timer=window.setTimeout(()=>reject(new Error(message)),milliseconds);promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
}
export async function engineConnection(){
 if(authToken)return;
 if(!connectionPromise)connectionPromise=(async()=>{
  const bridge=window as typeof window & {go?:{main?:{App?:{EngineConnection?:()=>Promise<{url:string;token:string}>}}}};
  const connect=bridge.go?.main?.App?.EngineConnection;
  if(!connect)throw new Error("The desktop bridge is unavailable. Restart OpenADE, or configure a development engine.");
  const connection=await bounded(connect(),12000,"The desktop bridge did not respond. Restart OpenADE to reconnect.");
  if(!connection.url||!connection.token)throw new Error("The desktop engine connection is incomplete.");
  DAEMON_URL=connection.url;authToken=connection.token;
 })().catch(reason=>{connectionPromise=null;throw reason;});
 await connectionPromise;
}
export const engineEventsURL=(sequence:number)=>`${DAEMON_URL}/api/events?after=${sequence}&token=${encodeURIComponent(authToken)}`;
export type SessionStatus =
  | "starting"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "stopped"
  | "interrupted";

export interface Session {
 model:string;effort:string;service_tier:string;instructions:string;
  id: string;
  title: string;
  prompt: string;
  agent: string;
  mode: "chat" | "tui";
  current_turn_id:string;
  generation:number;
  repo_root: string;
  worktree_path: string;
  branch: string;
  base_branch: string;
  ticket_key?: string;
  ticket_url?: string;
  status: SessionStatus;
  pid?: number;
  exit_code?: number;
  pr_url?: string;
  created_at: string;
  updated_at: string;
  finished_at?: string;
}

export interface ProjectTerminal {
  id: string;
  session_id: string;
  title: string;
  cwd: string;
  status: "running" | "completed" | "failed" | "stopped" | "interrupted";
  pid?: number;
  exit_code?: number;
  created_at: string;
  updated_at: string;
  finished_at?: string;
}

export interface ModelChoice{id:string;label:string;description:string;efforts:string[];service_tiers?:{id:string;label:string;description:string}[]}
export interface AgentInfo {
 models?:ModelChoice[];
  id: string;
  available: boolean;
  path: string;
}

export interface AgentCommand {
  id: string;
  name: string;
  kind: "command" | "skill";
  source: string;
  invocation: string;
  description?: string;
}

export interface QueuedMessage {
  id: string;
  session_id: string;
  text: string;
  status: "queued" | "dispatching";
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface Meta {
  agents: AgentInfo[];
  github_available: boolean;
  data_dir: string;
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  reviewDecision: string;
  updatedAt: string;
  author: { login: string };
  labels: { name: string }[];
}

export interface Ticket {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  url: string;
  source: string;
  fetched_at: string;
}

export interface ExternalConversation {
  id: string;
  provider: "codex" | "claude";
  title: string;
  cwd: string;
  project_root: string;
  updated_at: string;
}

export interface WorkspaceScan {
  root: string;
  projects: string[];
  conversations: ExternalConversation[];
}

export interface CreateSessionInput {
 model?:string;effort?:string;service_tier?:string;checkout?:"current"|"worktree";
  title: string;
  prompt: string;
  agent: string;
  mode?: "chat" | "tui";
  resume_id?: string;
  repo_root: string;
  base_branch: string;
  ticket_key?: string;
  ticket_url?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
 await engineConnection();
  const response = await fetch(`${DAEMON_URL}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(path==="/api/sessions"&&init?.method==="POST"?90000:30000),
    headers: {
      "Content-Type": "application/json",
      "Authorization":`Bearer ${authToken}`,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(payload.error ?? `OpenADE daemon returned ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function health(): Promise<boolean> {
  try {
    await request<{ ok: boolean }>("/api/health");
    return true;
  } catch {
    return false;
  }
}

export const getMeta = () => request<Meta>("/api/meta");

export async function listSessions(): Promise<Session[]> {
  const payload = await request<{ sessions: Session[] }>("/api/sessions");
  return payload.sessions ?? [];
}

export async function listProjects(): Promise<string[]> {
  const payload = await request<{ projects: string[] }>("/api/projects");
  return payload.projects ?? [];
}

export async function scanWorkspace(root: string): Promise<WorkspaceScan> {
  const payload = await request<WorkspaceScan>("/api/projects/scan", {
    method: "POST",
    body: JSON.stringify({ root }),
  });
  return {
    root: payload.root ?? root,
    projects: payload.projects ?? [],
    conversations: payload.conversations ?? [],
  };
}

export const createSession = (input: CreateSessionInput) =>
  request<Session>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const switchSessionSurface = (id: string, mode: "chat" | "tui") =>
  request<Session>(`/api/sessions/${id}/surface`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });

export const sendInput = (id: string, data: string) =>
  request<void>(`/api/sessions/${id}/input`, {
    method: "POST",
    body: JSON.stringify({ data }),
  });

export const sendMessage = (id: string, text: string) =>
  request<Session>(`/api/sessions/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });

export async function listMessageQueue(id: string): Promise<QueuedMessage[]> {
  const payload = await request<{ messages: QueuedMessage[] }>(`/api/sessions/${id}/message-queue`);
  return payload.messages ?? [];
}

export const enqueueMessage = (id: string, text: string) =>
  request<QueuedMessage>(`/api/sessions/${id}/message-queue`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });

export const updateQueuedMessage = (sessionId:string,messageId:string,text:string) =>
  request<void>(`/api/sessions/${sessionId}/message-queue/${messageId}`,{method:"PUT",body:JSON.stringify({text})});

export const removeQueuedMessage = (sessionId: string, messageId: string) =>
  request<void>(`/api/sessions/${sessionId}/message-queue/${messageId}`, { method: "DELETE" });

export const steerQueuedMessage = (sessionId: string, messageId: string) =>
  request<void>(`/api/sessions/${sessionId}/message-queue/${messageId}/steer`, { method: "POST" });

export const resumeTUI = (id: string) =>
  request<Session>(`/api/sessions/${id}/resume-tui`, { method: "POST" });

export async function listAgentCommands(id: string): Promise<AgentCommand[]> {
  const payload = await request<{ commands: AgentCommand[] }>(`/api/sessions/${id}/commands`);
  return payload.commands ?? [];
}

export const resizeTerminal = (id: string, rows: number, cols: number) =>
  request<void>(`/api/sessions/${id}/resize`, {
    method: "POST",
    body: JSON.stringify({ rows, cols }),
  });

export const stopSession = (id: string) =>
  request<void>(`/api/sessions/${id}/stop`, { method: "POST" });

export async function listTerminals(sessionId: string): Promise<ProjectTerminal[]> {
  const payload = await request<{ terminals: ProjectTerminal[] }>(
    `/api/sessions/${sessionId}/terminals`,
  );
  return payload.terminals ?? [];
}

export const createTerminal = (sessionId: string, options?: { title?: string; kind?: "shell" | "agent"; agent?: string; resume?: boolean }) =>
  request<ProjectTerminal>(`/api/sessions/${sessionId}/terminals`, {
    method: "POST",
    body: JSON.stringify({ title: options?.title ?? "", kind: options?.kind ?? "shell", agent: options?.agent ?? "", resume: options?.resume ?? false }),
  });

export const sendTerminalInput = (id: string, data: string) =>
  request<void>(`/api/terminals/${id}/input`, {
    method: "POST",
    body: JSON.stringify({ data }),
  });

export const resizeProjectTerminal = (id: string, rows: number, cols: number) =>
  request<void>(`/api/terminals/${id}/resize`, {
    method: "POST",
    body: JSON.stringify({ rows, cols }),
  });

export const stopTerminal = (id: string) =>
  request<void>(`/api/terminals/${id}/stop`, { method: "POST" });

export async function getDiff(id: string, scope: "branch" | "working" | "staged" | "turn" = "branch"): Promise<string> {
  return (await request<{ diff: string }>(`/api/sessions/${id}/diff?scope=${scope}`)).diff;
}

export async function getFiles(id: string,ignored=false): Promise<string[]> {
  return (await request<{ files: string[] }>(`/api/sessions/${id}/files?ignored=${ignored?"1":"0"}`)).files;
}

export async function listPullRequests(repo: string): Promise<PullRequest[]> {
  const payload = await request<{ pull_requests: PullRequest[] }>(
    `/api/github/pull-requests?repo=${encodeURIComponent(repo)}`,
  );
  return payload.pull_requests ?? [];
}

export async function createPullRequest(input: {
  sessionId: string;
  title: string;
  body: string;
  base: string;
}): Promise<string> {
  const payload = await request<{ url: string }>("/api/github/pull-requests", {
    method: "POST",
    body: JSON.stringify({
      SessionID: input.sessionId,
      Title: input.title,
      Body: input.body,
      Base: input.base,
    }),
  });
  return payload.url;
}

export const getTicket = (key: string) =>
  request<Ticket>(`/api/jira/tickets/${encodeURIComponent(key)}`);

export function streamURL(id: string,after=0): string {
  return `${DAEMON_URL.replace(/^http/, "ws")}/api/sessions/${id}/stream?after=${after}&token=${encodeURIComponent(authToken)}`;
}

export function terminalStreamURL(id: string,after=0): string {
  return `${DAEMON_URL.replace(/^http/, "ws")}/api/terminals/${id}/stream?after=${after}&token=${encodeURIComponent(authToken)}`;
}

export function projectName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function relativeTime(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export interface GitCommit { sha:string; parents:string; author:string; date:string; subject:string; }
export const getHistory = (id:string) => request<{branch:string;commits:GitCommit[]}>(`/api/sessions/${id}/history`);
export const getFile = (id:string,path:string) => request<{path:string;content:string}>(`/api/sessions/${id}/file?path=${encodeURIComponent(path)}`);
export const saveFile = (id:string,path:string,content:string,original:string) => request<{path:string;content:string}>(`/api/sessions/${id}/file?path=${encodeURIComponent(path)}`,{method:"PUT",body:JSON.stringify({content,original})});

export interface EngineSnapshot{sequence:number;sessions:Session[];projects:string[];queues:Record<string,QueuedMessage[]>}
export const getEngineState=()=>request<EngineSnapshot>("/api/state");

export const commitChanges=(id:string,message:string,staged=false)=>request<{sha:string}>(`/api/sessions/${id}/commit`,{method:"POST",body:JSON.stringify({message,staged})});

export const updateModel=(id:string,model:string,effort:string,service_tier="")=>request<void>(`/api/sessions/${id}/model`,{method:"POST",body:JSON.stringify({model,effort,service_tier})});

export const getBranches=(root:string)=>request<{branches:string[];current:string}>(`/api/projects/branches?root=${encodeURIComponent(root)}`);
export const getPreviewServers=(id:string)=>request<{servers:string[]}>(`/api/sessions/${id}/preview-servers`);
export const stageFile=(id:string,path:string,staged:boolean)=>request<void>(`/api/sessions/${id}/stage`,{method:"POST",body:JSON.stringify({path,staged})});

export const signInProvider=(provider:string)=>request<Session>(`/api/providers/${encodeURIComponent(provider)}/sign-in`,{method:"POST"});

export const updateSessionDetails=(id:string,details:{title?:string;instructions?:string})=>request<void>(`/api/sessions/${id}`,{method:"PATCH",body:JSON.stringify(details)});
