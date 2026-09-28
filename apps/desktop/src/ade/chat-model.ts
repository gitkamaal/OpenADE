export type ChatActivityKind = "thinking" | "command" | "tool" | "notice" | "question" | "subagent";

export interface ChatActivity {
  id: string;
  kind: ChatActivityKind;
  title: string;
  detail?: string;
  status?: "pending" | "answered" | "dismissed";
  docId?: string;
}

export interface GeneratedImage {id:string;name:string;mime:"image/png";size:number}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant" | "system";
  markdown: string;
  activities: ChatActivity[];
  generatedImages: GeneratedImage[];
  streaming?: boolean;
  timestamp?: number;
}

type JsonRecord = Record<string, unknown>;

export function createTranscriptParser(initialPrompt:string,initialCreatedAt?:string){
  const turns: ChatTurn[] = [];
  if (initialPrompt.trim()) {
    turns.push({ id: "user-0", role: "user", markdown: initialPrompt.trim(), activities: [],generatedImages:[],timestamp:parseTimestamp(initialCreatedAt) });
  }

  let assistant = newAssistant(0);
  let partial = "";
  let finalMessage = "";
  let providerMessages=new Map<string,string>();

  // Strip terminal escapes one line at a time. A raw TUI can leave an OSC
  // sequence unterminated; stripping the entire transcript at once would then
  // swallow every later JSON event, including valid streamed chat responses.
  let carry="";
  const consume=(rawLine:string)=>{
    const line = stripANSI(rawLine).trim();
    if (!line || line.startsWith("Reading additional input from stdin")) return;
    if (!line.startsWith("{")) {
      if (assistant.activities.filter(activity => activity.kind === "notice").length < 20) {
        const message = line.slice(0, 2000);
        addActivity(assistant, "notice", noticeTitle(message), message);
      }
      return;
    }
    const event = parseEvent(line);
    if (!event) return;

    if (event.type === "openade.fork_source") {
      commitAssistant(turns, assistant, finalMessage || partial);
      turns.push({id:`fork-${turns.length}`,role:"system",markdown:String(event.title??"Previous chat"),activities:[],generatedImages:[]});
      assistant=newAssistant(turns.length);partial="";finalMessage="";providerMessages=new Map();
      return;
    }

    if (event.type === "openade.user_message") {
      // Steering can settle already-streamed assistant text before the
      // provider's turn/completed frame arrives. The accepted user marker is
      // the durable boundary for that preceding entry's hover timestamp.
      if(assistant.timestamp===undefined)assistant.timestamp=parseTimestamp(event.created_at);
      commitAssistant(turns, assistant, finalMessage || partial);
      turns.push({
        id: `user-${turns.length}`,
        role: "user",
        markdown: String(event.text ?? "").trim(),
        activities: [],
        generatedImages: [],
        timestamp: parseTimestamp(event.created_at),
      });
      assistant = newAssistant(turns.length);
      partial = "";
      finalMessage = "";providerMessages=new Map();
      return;
    }

    const type = String(event.type ?? "");
    if(type==="turn.completed")assistant.timestamp=parseTimestamp(event.created_at);
    if(type==="openade.turn_finished"&&assistant.timestamp===undefined)assistant.timestamp=parseTimestamp(event.created_at);
    if(type==="openade.agent_delta"||type==="openade.agent_message"){const id=String(event.id??"message"),text=String(event.text??"");providerMessages.set(id,type==="openade.agent_delta"?(providerMessages.get(id)??"")+text:text);finalMessage=[...providerMessages.values()].filter(Boolean).join("\n\n");}

    const item = isRecord(event.item) ? event.item : null;
    if (type === "error" || type === "turn.failed") {
      const error = isRecord(event.error) ? event.error : event;
      const message = String(error.message ?? event.message ?? "Provider failed to complete this turn").slice(0, 2000);
      addActivity(assistant, "notice", noticeTitle(message), message);
    }
    if(type==="openade.tool"){
      const title=String(event.title??"Used a tool"),detail=String(event.detail??""),wireID=String(event.id??"");
      if(wireID){
        const id=`${assistant.id}-tool-${wireID}`;
        const existing=assistant.activities.find(activity=>activity.id===id);
        if(existing){existing.title=title;existing.detail=detail;}
        else assistant.activities.push({id,kind:"tool",title,detail});
      }else addActivity(assistant,"tool",title,detail);
    }
    if(type==="openade.question"){
      const wireID=String(event.id??""),header=String(event.header??"Question").trim().slice(0,256),status=String(event.status??"");
      if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wireID)&&(status==="pending"||status==="answered"||status==="dismissed")){
        const id=`${assistant.id}-question-${wireID}`;
        const existing=assistant.activities.find(activity=>activity.id===id);
        if(existing){existing.status=status;}
        else assistant.activities.push({id,kind:"question",title:header||"Question",status});
      }
    }
    if(type==="openade.subagent"){
      const docId=String(event.doc_id??""),title=String(event.title??"Subagent").trim().slice(0,100),wireID=String(event.id??"");
      if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(docId)&&wireID&&wireID.length<=256&&!assistant.activities.some(activity=>activity.docId===docId)){
        assistant.activities.push({id:`${assistant.id}-subagent-${docId}`,kind:"subagent",title:title||"Subagent",docId});
      }
    }
    if(type==="openade.generated_image"){
      const id=String(event.id??""),name=String(event.name??"Generated image"),mime=String(event.mime??""),size=Number(event.size??0);
      if(/^[0-9a-f]{64}$/.test(id)&&mime==="image/png"&&name.length<=256&&Number.isFinite(size)&&size>0&&size<=24*1024*1024&&!assistant.generatedImages.some(image=>image.id===id))assistant.generatedImages.push({id,name,mime,size});
    }
    if (type === "thread.started" || type === "turn.started") {
      addActivity(assistant, "thinking", "Thinking");
    }
    if (type === "item.started" && item?.type === "command_execution") {
      addActivity(assistant, "command", commandTitle(String(item.command ?? "Run command")));
    }
    if (type === "item.completed" && item?.type === "command_execution") {
      const output = String(item.aggregated_output ?? "").trim();
      const command = String(item.command ?? "Command finished");
      completeActivity(assistant, "command", commandTitle(command), compactDetail(output));
    }
    if (type === "item.completed" && item?.type === "agent_message") {
      finalMessage = String(item.text ?? "").trim();
    }
    if (type === "item.completed" && item?.type === "error") {
      const message = String(item.message ?? "Agent error");
      addActivity(assistant, "notice", noticeTitle(message), message);
    }

    if (type === "stream_event" && isRecord(event.event)) {
      const delta = isRecord(event.event.delta) ? event.event.delta : null;
      if (delta?.type === "text_delta") partial += String(delta.text ?? "");
      if (delta?.type === "thinking_delta") addActivity(assistant, "thinking", "Thinking");
    }
    if (type === "assistant" && isRecord(event.message) && Array.isArray(event.message.content)) {
      const content = event.message.content.filter(isRecord);
      const text = content
        .filter((block) => block.type === "text")
        .map((block) => String(block.text ?? ""))
        .join("\n")
        .trim();
      if (text) finalMessage = text;
      for (const block of content.filter((entry) => entry.type === "tool_use")) {
        addActivity(assistant, "tool", toolTitle(String(block.name ?? "Use tool")));
      }
    }
    if (type === "result" && typeof event.result === "string" && event.result.trim()) {
      finalMessage = event.result.trim();
    }
  };
  return {
    append(chunk:string){const lines=(carry+chunk.replace(/\r/g,"")).split("\n");carry=lines.pop()??"";for(const line of lines)consume(line);},
    snapshot(running:boolean):ChatTurn[]{
      const current={...assistant,activities:assistant.activities.map(activity=>({...activity})),generatedImages:assistant.generatedImages.map(image=>({...image})),markdown:(finalMessage||partial).trim(),streaming:running};
      return current.markdown||current.activities.length||current.generatedImages.length||running?[...turns,current]:[...turns];
    },
  };
}
export function parseChatTranscript(value:string,initialPrompt:string,running:boolean,initialCreatedAt?:string):ChatTurn[]{const parser=createTranscriptParser(initialPrompt,initialCreatedAt);parser.append(value+"\n");return parser.snapshot(running);}

// Older transcripts can lack inline created_at markers. The durable turn log
// supplies exact start/finish times, but steering adds user rows without a new
// turn. Only align a complete one-to-one history when every prompt agrees.
export function withDurableTurnTimestamps(turns:ChatTurn[],records:{generation:number;prompt:string;started_at:string;finished_at:string|null}[],expectedGeneration:number):ChatTurn[]{
  if(!records.length)return turns;
  const ordered=[...records].sort((left,right)=>left.generation-right.generation);
  if(ordered.at(-1)?.generation!==expectedGeneration)return turns;
  const pairs:{user:ChatTurn;assistant?:ChatTurn}[]=[];
  for(const turn of turns){
    if(turn.role==="system")continue;
    if(turn.role==="user")pairs.push({user:turn});
    else if(!pairs.length||pairs.at(-1)?.assistant)return turns;
    else pairs[pairs.length-1].assistant=turn;
  }
  if(pairs.length!==ordered.length)return turns;
  const matched=pairs;
  if(matched.some((pair,index)=>typeof ordered[index].prompt!=="string"||pair.user.markdown.trim()!==ordered[index].prompt.trim()))return turns;
  const times=new Map<string,number>();
  matched.forEach((pair,index)=>{
    const start=Date.parse(ordered[index].started_at),finish=Date.parse(ordered[index].finished_at??"");
    if(pair.user.timestamp===undefined&&Number.isFinite(start))times.set(pair.user.id,start);
    if(pair.assistant&&pair.assistant.timestamp===undefined&&Number.isFinite(finish))times.set(pair.assistant.id,finish);
  });
  return times.size?turns.map(turn=>times.has(turn.id)?{...turn,timestamp:times.get(turn.id)}:turn):turns;
}

function parseTimestamp(value:unknown):number|undefined{if(typeof value!=="string")return undefined;const ms=Date.parse(value);return Number.isFinite(ms)?ms:undefined;}

function newAssistant(index: number): ChatTurn {
  return { id: `assistant-${index}`, role: "assistant", markdown: "", activities: [],generatedImages:[] };
}

function commitAssistant(
  turns: ChatTurn[],
  assistant: ChatTurn,
  markdown: string,
  force = false,
) {
  assistant.markdown = markdown.trim();
  if (force || assistant.markdown || assistant.activities.length || assistant.generatedImages.length) turns.push(assistant);
}

function addActivity(
  turn: ChatTurn,
  kind: ChatActivityKind,
  title: string,
  detail?: string,
) {
  const previous = turn.activities.at(-1);
  if (previous?.kind === kind && previous.title === title && previous.detail === detail) return;
  turn.activities.push({ id: `${turn.id}-activity-${turn.activities.length}`, kind, title, detail });
}

function completeActivity(
  turn: ChatTurn,
  kind: ChatActivityKind,
  title: string,
  detail?: string,
) {
  const existing = [...turn.activities].reverse().find((activity) => activity.kind === kind && activity.title === title);
  if (existing) {
    existing.detail = detail;
    return;
  }
  addActivity(turn, kind, title, detail);
}

function commandTitle(command: string): string {
  const singleLine = command.replace(/\s+/g, " ").trim();
  return singleLine.length > 74 ? `Ran ${singleLine.slice(0, 71)}…` : `Ran ${singleLine}`;
}

function toolTitle(name: string): string {
  const readable = name.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return readable || "Used a tool";
}

function noticeTitle(message: string): string {
  if (/^20\d\d-.*\b(?:WARN|ERROR)\b/.test(message)) return "Provider connection notice";
  if (message.includes("codex_hooks") && message.includes("deprecated")) return "Codex configuration notice";
  if (message.includes("Skill descriptions were shortened")) return "Skill context compacted";
  const firstLine = message.replace(/[`*_]/g, "").split("\n")[0].trim();
  return firstLine.length > 68 ? `${firstLine.slice(0, 65)}…` : firstLine || "Agent notice";
}

function compactDetail(value: string): string | undefined {
  if (!value) return undefined;
  const lines = value.split("\n").filter(Boolean);
  return lines.slice(-4).join("\n").slice(0, 600);
}

function parseEvent(line: string): JsonRecord | null {
  try {
    const value = JSON.parse(line) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripANSI(value: string): string {
  return value.replace(/\x1B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, "");
}
