export type ChatActivityKind = "thinking" | "command" | "tool" | "notice" | "question" | "subagent";

export interface ChatActivity {
  id: string;
  kind: ChatActivityKind;
  title: string;
  detail?: string;
  operation?: "edit" | "write" | "patch";
  paths?: string[];
  failed?: boolean;
  status?: "pending" | "answered" | "dismissed";
  docId?: string;
  subagentState?: "starting" | "spawned" | "failed";
}

export interface GeneratedImage {id:string;name:string;mime:"image/png";size:number}

export type ChatSegment =
  | {id:string;kind:"text";markdown:string}
  | {id:string;kind:"activity";activities:ChatActivity[]};

export interface ChatTurn {
  id: string;
  role: "user" | "assistant" | "system";
  markdown: string;
  activities: ChatActivity[];
  generatedImages: GeneratedImage[];
  segments?: ChatSegment[];
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
  let activityBoundaries:{at:number;ids:string[]}[]=[];
  let orderedText=true;
  const commitCurrent=()=>{
    const markdown=(finalMessage||partial).trim();
    assistant.segments=buildSegments(markdown,assistant.activities,activityBoundaries,orderedText);
    commitAssistant(turns,assistant,markdown);
  };

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
      commitCurrent();
      turns.push({id:`fork-${turns.length}`,role:"system",markdown:String(event.title??"Previous chat"),activities:[],generatedImages:[]});
      assistant=newAssistant(turns.length);partial="";finalMessage="";providerMessages=new Map();activityBoundaries=[];orderedText=true;
      return;
    }

    if (event.type === "openade.user_message") {
      // Steering can settle already-streamed assistant text before the
      // provider's turn/completed frame arrives. The accepted user marker is
      // the durable boundary for that preceding entry's hover timestamp.
      if(assistant.timestamp===undefined)assistant.timestamp=parseTimestamp(event.created_at);
      commitCurrent();
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
      finalMessage = "";providerMessages=new Map();activityBoundaries=[];orderedText=true;
      return;
    }

    if (event.type === "openade.child_turn_started") {
      // A provider may resume a child thread without echoing another user
      // item. Keep its next answer separate from the completed assignment.
      commitCurrent();
      assistant = newAssistant(turns.length);
      partial = "";
      finalMessage = "";
      providerMessages = new Map();activityBoundaries=[];orderedText=true;
      return;
    }

    const textBefore=(finalMessage||partial).trim();
    const activityCount=assistant.activities.length;
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
      const operation=event.operation==="edit"||event.operation==="write"||event.operation==="patch"?event.operation:undefined;
      const paths=Array.isArray(event.paths)?event.paths.filter((path):path is string=>typeof path==="string"&&path.length>0&&path.length<=1024).slice(0,64):[];
      const failed=event.failed===true;
      if(wireID){
        const id=`${assistant.id}-tool-${wireID}`;
        const existing=assistant.activities.find(activity=>activity.id===id);
        if(existing){
          if(paths.length||!existing.paths?.length){existing.title=title;existing.detail=detail;existing.operation=operation;}
          if(paths.length)existing.paths=paths;
          if(failed)existing.failed=true;
        }
        else assistant.activities.push({id,kind:"tool",title,detail,operation,paths,failed});
      }else{
        addActivity(assistant,"tool",title,detail);
        const activity=assistant.activities.at(-1);
        if(activity?.kind==="tool"){activity.operation=operation;activity.paths=paths;activity.failed=failed;}
      }
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
    if(type==="openade.unlinked_agent"){
      const wireID=String(event.id??""),title=String(event.title??"Subagent").trim().slice(0,100),status=String(event.status??"");
      if(wireID&&wireID.length<=256&&(status==="starting"||status==="spawned"||status==="failed")){
        const id=`${assistant.id}-unlinked-agent-${wireID}`;
        const existing=assistant.activities.find(activity=>activity.id===id);
        if(existing){existing.subagentState=status;existing.title=title||"Subagent";}
        else assistant.activities.push({id,kind:"subagent",title:title||"Subagent",subagentState:status});
      }
    }
    if(type==="openade.generated_image"){
      const id=String(event.id??""),name=String(event.name??"Generated image"),mime=String(event.mime??""),size=Number(event.size??0);
      if(/^[0-9a-f]{64}$/.test(id)&&mime==="image/png"&&name.length<=256&&Number.isFinite(size)&&size>0&&size<=24*1024*1024&&!assistant.generatedImages.some(image=>image.id===id))assistant.generatedImages.push({id,name,mime,size});
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
      if (delta?.type === "thinking_delta") appendThought(assistant, String(delta.thinking ?? delta.text ?? ""),false,Boolean(activityBoundaries.length&&activityBoundaries.at(-1)!.at<textBefore.length));
    }
    if (type === "assistant" && isRecord(event.message) && Array.isArray(event.message.content)) {
      const content = event.message.content.filter(isRecord);
      const text = content
        .filter((block) => block.type === "text")
        .map((block) => String(block.text ?? ""))
        .join("\n")
        .trim();
      if (text) finalMessage = text;
      for (const block of content) {
        if(block.type==="thinking")appendThought(assistant,String(block.thinking??""),true,Boolean(activityBoundaries.length&&activityBoundaries.at(-1)!.at<textBefore.length));
        if(block.type!=="tool_use"||block.name==="Agent"||block.name==="Task")continue;
        addActivity(assistant, "tool", toolTitle(String(block.name ?? "Use tool")));
      }
    }
    if (type === "result" && typeof event.result === "string" && event.result.trim()) {
      finalMessage = event.result.trim();
    }
    if(assistant.activities.length>activityCount){
      const ids=assistant.activities.slice(activityCount).map(activity=>activity.id);
      const previous=activityBoundaries.at(-1);
      if(previous?.at===textBefore.length)previous.ids.push(...ids);
      else activityBoundaries.push({at:textBefore.length,ids});
    }
    const textAfter=(finalMessage||partial).trim();
    if(!textAfter.startsWith(textBefore))orderedText=false;
  };
  return {
    append(chunk:string){const lines=(carry+chunk.replace(/\r/g,"")).split("\n");carry=lines.pop()??"";for(const line of lines)consume(line);},
    snapshot(running:boolean):ChatTurn[]{
      const markdown=(finalMessage||partial).trim();
      const activities=assistant.activities.map(activity=>({...activity}));
      const current={...assistant,activities,generatedImages:assistant.generatedImages.map(image=>({...image})),markdown,segments:buildSegments(markdown,activities,activityBoundaries,orderedText),streaming:running};
      return current.markdown||current.activities.length||current.generatedImages.length||running?[...turns,current]:[...turns];
    },
  };
}

function buildSegments(markdown:string,activities:ChatActivity[],boundaries:{at:number;ids:string[]}[],ordered:boolean):ChatSegment[]|undefined{
  if(!ordered||!boundaries.length||boundaries.some(boundary=>boundary.at>markdown.length))return undefined;
  const byID=new Map(activities.map(activity=>[activity.id,activity]));
  const segments:ChatSegment[]=[];
  let cursor=0;
  for(const [index,boundary] of boundaries.entries()){
    if(boundary.at>cursor)segments.push({id:`text-${index}`,kind:"text",markdown:markdown.slice(cursor,boundary.at)});
    const group=boundary.ids.map(id=>byID.get(id)).filter((activity):activity is ChatActivity=>Boolean(activity));
    if(group.length)segments.push({id:`activity-${group[0].id}`,kind:"activity",activities:group});
    cursor=boundary.at;
  }
  if(cursor<markdown.length)segments.push({id:`text-${boundaries.length}`,kind:"text",markdown:markdown.slice(cursor)});
  return segments.length?segments:undefined;
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

function appendThought(turn:ChatTurn,text:string,complete=false,forceNew=false){
  const bounded=text.slice(0,64*1024),previous=turn.activities.at(-1);
  if(!bounded.trim())return;
  if(!forceNew&&previous?.kind==="thinking"){
    if(complete){if(!previous.detail||bounded.startsWith(previous.detail))previous.detail=bounded||previous.detail;else if(bounded!==previous.detail)addActivity(turn,"thinking","Thought process",bounded);}
    else if(bounded)previous.detail=((previous.detail??"")+bounded).slice(0,64*1024);
    return;
  }
  addActivity(turn,"thinking","Thought process",bounded||undefined);
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
