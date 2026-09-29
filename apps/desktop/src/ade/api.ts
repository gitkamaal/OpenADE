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
 const bridge=window as typeof window & {go?:{main?:{App?:{EngineConnection?:()=>Promise<{url:string;token:string}>}}}};
 const connect=bridge.go?.main?.App?.EngineConnection;
 // The native profile connection is authoritative over development defaults.
 if(authToken&&!connect)return;
 if(!connectionPromise)connectionPromise=(async()=>{
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
 model:string;effort:string;service_tier:string;instructions:string;provider_session_id:string;archived:boolean;
  id: string;
  parent_session_id?: string;
  fork_source_id?: string;
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
 adapter_version?:string;
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
  status: "queued" | "dispatching" | "provider-starting" | "steering" | "uncertain";
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
 auto_title?:boolean;
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

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
export interface AgentUsageWindow { label:string; used_fraction:number; resets_at?:number }
export interface AgentAccount { id:string; provider:string; email?:string; plan_label?:string; auth_kind:string; active:boolean; switchable:boolean; usage_windows:AgentUsageWindow[]; usage_fetched_at?:number; usage_error?:string }
export interface AgentAccountsSnapshot { accounts:AgentAccount[]; warnings:{provider:string;message:string}[] }
export const getAgentAccounts = (refresh=false) => request<AgentAccountsSnapshot>(`/api/agent-accounts${refresh?"?refresh=1":""}`);
export const activateCodexAccount = (id:string) => request<void>(`/api/agent-accounts/codex/${encodeURIComponent(id)}/activate`,{method:"POST"});
export const forgetCodexAccount = (id:string) => request<void>(`/api/agent-accounts/codex/${encodeURIComponent(id)}`,{method:"DELETE"});
export const getProviderModels = async (agent:string,refresh=false) => (await request<{models:ModelChoice[]}>(`/api/providers/${encodeURIComponent(agent)}/models${refresh?"?refresh=1":""}`)).models ?? [];
export interface TitleSettings { harness: string; model: string }
export const getTitleSettings = () => request<TitleSettings>("/api/title-settings");
export const setTitleSettings = (settings: TitleSettings) => request<TitleSettings>("/api/title-settings", { method: "PATCH", body: JSON.stringify(settings) });

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

export const createSideChat = (sourceId:string, mode:"fresh"|"fork", parentSessionId?:string) =>
  request<Session>(`/api/sessions/${encodeURIComponent(sourceId)}/fork`, {
    method:"POST",
    body:JSON.stringify({mode,parent_session_id:parentSessionId??""}),
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

export interface SessionTurnTime {generation:number;prompt:string;started_at:string;finished_at:string|null}
export interface SubagentDoc {id:string;spawn_item_id:string;child_thread_id:string;title:string;status:"running"|"done"|"failed"|"interrupted";output:string;cursor:number;reset:boolean}
export type SubagentSummary=Omit<SubagentDoc,"output"|"cursor"|"reset">;
export const fetchSubagent=(sessionId:string,docId:string,after=0)=>request<SubagentDoc>(`/api/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(docId)}?after=${after}`,{cache:"no-store"});
export const fetchSubagentSummaries=async(sessionId:string,ids:string[])=>{
 const payload=await request<{subagents:SubagentSummary[]}>(`/api/sessions/${encodeURIComponent(sessionId)}/subagents?ids=${encodeURIComponent(ids.join(","))}`,{cache:"no-store"});
 return payload.subagents;
};
export async function listSessionTurnTimes(id:string):Promise<SessionTurnTime[]>{
  const payload=await request<{turns:SessionTurnTime[]}>(`/api/sessions/${id}/turns`);
  return Array.isArray(payload.turns)?payload.turns:[];
}

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

export async function getDiff(id: string, scope: "branch" | "working" | "staged" | "turn" | "commit" = "branch", sha?: string): Promise<string> {
  const params = new URLSearchParams({scope});
  if (scope === "commit" && sha) params.set("sha", sha);
  return (await request<{ diff: string }>(`/api/sessions/${id}/diff?${params}`)).diff;
}

export async function getFiles(id: string,ignored=false): Promise<string[]> {
  return (await request<{ files: string[] }>(`/api/sessions/${id}/files?ignored=${ignored?"1":"0"}`)).files;
}

export const fileWatchURL=(id:string)=>`${DAEMON_URL.replace(/^http/,"ws")}/api/sessions/${id}/files/watch?token=${encodeURIComponent(authToken)}`;

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
 if(!path)return "No project";
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

export interface GitHistoryRef {kind:"branch"|"remote"|"tag";label:string}
export interface GitCommit { sha:string; parents:string; author:string; email:string; date:string; subject:string; refs:GitHistoryRef[]; }
export interface GitHistoryPage {branch:string;commits:GitCommit[];branch_tips:GitCommit[];head_sha:string;next_cursor:number|null;total_count:number|null;head_commit_count:number|null;comparison?:{base:string;ahead:number;behind:number}}
export const getHistory = (id:string,cursor=0,q="") => request<GitHistoryPage>(`/api/sessions/${id}/history?${new URLSearchParams({cursor:String(cursor),q})}`);
export const fetchHistory = (id:string) => request<{ok:boolean}>(`/api/sessions/${id}/history/fetch`,{method:"POST"});
export const getFile = (id:string,path:string) => request<{path:string;content:string}>(`/api/sessions/${id}/file?path=${encodeURIComponent(path)}`);
export const saveFile = (id:string,path:string,content:string,original:string) => request<{path:string;content:string}>(`/api/sessions/${id}/file?path=${encodeURIComponent(path)}`,{method:"PUT",body:JSON.stringify({content,original})});

export type NewThreadArtworkEffect="none"|"dither"|"ascii"|"halftone"|"scanlines";
export interface NewThreadArtworkImage{id:string;name:string;mime:string}
export interface NewThreadArtworkState{image?:NewThreadArtworkImage;effect:NewThreadArtworkEffect}
export interface EngineSnapshot{sequence:number;sessions:Session[];projects:string[];project_names?:Record<string,string>;removed_projects?:string[];queues:Record<string,QueuedMessage[]>;new_thread_artwork:NewThreadArtworkState}
export const getEngineState=()=>request<EngineSnapshot>("/api/state");

export const commitChanges=(id:string,message:string,staged=false)=>request<{sha:string}>(`/api/sessions/${id}/commit`,{method:"POST",body:JSON.stringify({message,staged})});

export const updateModel=(id:string,model:string,effort:string,service_tier="")=>request<void>(`/api/sessions/${id}/model`,{method:"POST",body:JSON.stringify({model,effort,service_tier})});

export const getBranches=(root:string)=>request<{branches:string[];current:string}>(`/api/projects/branches?root=${encodeURIComponent(root)}`);
export const getPreviewServers=(id:string)=>request<{servers:string[]}>(`/api/sessions/${id}/preview-servers`);
export const stageFile=(id:string,path:string,staged:boolean)=>request<void>(`/api/sessions/${id}/stage`,{method:"POST",body:JSON.stringify({path,staged})});

export const signInProvider=(provider:string)=>request<Session>(`/api/providers/${encodeURIComponent(provider)}/sign-in`,{method:"POST"});

export const updateSessionDetails=(id:string,details:{title?:string;instructions?:string})=>request<void>(`/api/sessions/${id}`,{method:"PATCH",body:JSON.stringify(details)});

export interface ProjectDirectoryListing{path:string;parent:string;entries:{name:string;path:string}[];git?:boolean;limited?:boolean}
export const getProjectDirectories=(path="")=>request<ProjectDirectoryListing>(`/api/projects/directories?path=${encodeURIComponent(path)}`);
export const getProjectLocations=()=>request<{locations:{name:string;path:string}[]}>("/api/projects/locations");
export const registerProject=(path:string)=>request<{path:string}>("/api/projects",{method:"POST",body:JSON.stringify({path})});
export const renameProject=(path:string,name:string)=>request<{path:string;name:string}>("/api/projects/rename",{method:"POST",body:JSON.stringify({path,name})});
export const removeProject=(path:string,session_ids:string[])=>request<{path:string;removed_sessions:number;cleanup_warning?:string}>("/api/projects/remove",{method:"POST",body:JSON.stringify({path,session_ids,confirm:true})});
export const renameSession=(id:string,title:string)=>request<void>(`/api/sessions/${id}`,{method:"PATCH",body:JSON.stringify({title})});
export const setSessionArchived=(id:string,archived:boolean)=>request<void>(`/api/sessions/${id}/archive`,{method:"PATCH",body:JSON.stringify({archived})});
export const deleteSession=(id:string)=>request<{cleanup_warning?:string}|undefined>(`/api/sessions/${id}`,{method:"DELETE"});

export interface Attachment {id:string;name:string;path:string;mime:string;size:number}
export const uploadAttachment=(file:File)=>request<Attachment>(`/api/attachments?name=${encodeURIComponent(file.name)}`,{method:"POST",headers:{"Content-Type":file.type||"application/octet-stream"},body:file});
export const attachmentMediaURL=(id:string)=>`/api/attachments/${encodeURIComponent(id)}/media`;
export const generatedImageMediaURL=(sessionId:string,id:string)=>`/api/sessions/${encodeURIComponent(sessionId)}/generated-images/${encodeURIComponent(id)}/media`;

export const fileMediaURL=(sessionId:string,path:string)=>`/api/sessions/${encodeURIComponent(sessionId)}/file-media?path=${encodeURIComponent(path)}`;

// Media bytes use the same private header as JSON requests. Bearer tokens must
// not appear in image URLs, accessibility trees, captures or the browser cache.
export async function fetchMedia(source:string,signal:AbortSignal){await engineConnection();const path=new URL(source,DAEMON_URL);if(!/^\/api\/(?:attachments\/[^/]+\/media|sessions\/[^/]+\/file-media|sessions\/[^/]+\/generated-images\/[0-9a-f]{64}\/media|new-thread-artwork\/media)$/.test(path.pathname))throw Error("Unsupported image source.");path.searchParams.delete("token");const mutableWorkspaceImage=path.pathname.endsWith('/file-media');const response=await fetch(DAEMON_URL+path.pathname+path.search,{signal,cache:mutableWorkspaceImage?'no-store':'default',headers:{Authorization:`Bearer ${authToken}`}});if(!response.ok)throw Error("Image unavailable.");return response.blob();}

export interface ProviderQuestion {id:string;header:string;question:string;multiSelect?:boolean;isOther:boolean;isSecret:boolean;options:{label:string;description:string}[]|null}
export interface ProviderRequest {id:string;generation:number;kind:"question"|"approval";title:string;detail:string;questions:ProviderQuestion[];decisions:string[]}
export interface ProviderState {connected:boolean;steering:boolean;requests:ProviderRequest[];context:{tokens:number|null;window:number|null}}
export const getProviderState=(id:string,signal?:AbortSignal)=>request<ProviderState>(`/api/sessions/${id}/provider-state`,{signal});
export const replyToProvider=(id:string,question:ProviderRequest,reply:{answers?:Record<string,string[]>;decision?:string})=>request<void>(`/api/sessions/${id}/provider-requests/${question.id}`,{method:"POST",body:JSON.stringify({generation:question.generation,...reply})});

export const newThreadArtworkMediaURL=(id:string)=>`/api/new-thread-artwork/media?version=${encodeURIComponent(id)}`;
export const uploadNewThreadArtwork=(file:File)=>request<NewThreadArtworkState>(`/api/new-thread-artwork?name=${encodeURIComponent(file.name)}`,{method:"POST",headers:{"Content-Type":file.type||"application/octet-stream"},body:file});
export const removeNewThreadArtwork=()=>request<NewThreadArtworkState>("/api/new-thread-artwork",{method:"DELETE"});
export const setNewThreadArtworkEffect=(effect:NewThreadArtworkEffect)=>request<NewThreadArtworkState>("/api/new-thread-artwork/effect",{method:"PATCH",body:JSON.stringify({effect})});
