import {MessageRail} from "./MessageRail";
import {parseAttachments,AttachmentImage} from "./Attachments";
import { ProviderIcon } from "./ProviderIcon";
import { copyText } from "./clipboard";
import {
  CaretDown,
  ChatCircleDots,
  Check,
  Copy,
  Lightning,
  SpinnerGap,
  TerminalWindow,
  Wrench,
} from "@phosphor-icons/react";
import { memo, useLayoutEffect, useEffect, useMemo, useRef, useState } from "react";
import { fetchSubagentSummaries, generatedImageMediaURL, getTranscriptPage, listSessionTurnTimes, Session, SessionTurnTime, SubagentSummary } from "./api";
import { ChatActivity, ChatSegment, ChatTurn, GeneratedImage, createTranscriptParser, withDurableTurnTimestamps } from "./chat-model";
import { MarkdownMessage } from "./MarkdownMessage";
import { parseReviewComments } from "./ReviewComments";

const hoverTimestampFormatter=new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:true});
const transcriptPageBytes=1024*1024;
const historyWindowBytes=8*transcriptPageBytes;
type HistoryWindow={sessionId:string;start:number;end:number;liveEnd:number;alignedStart:boolean;bytes:Uint8Array};
const decodePage=(value:string)=>Uint8Array.from(atob(value),character=>character.charCodeAt(0));
function joinPages(left:Uint8Array,right:Uint8Array){const joined=new Uint8Array(left.length+right.length);joined.set(left);joined.set(right,left.length);return joined;}
function historyText(history:HistoryWindow){
 let text=new TextDecoder().decode(history.bytes);
 // A byte page can begin inside a UTF-8 code point or a JSONL event. The
 // preceding page restores that event when the reader moves further back.
 if(history.start>0&&!history.alignedStart){const newline=text.indexOf("\n");text=newline<0?"":text.slice(newline+1);}
 return text;
}
function anchoredTurnIndex(turns:ChatTurn[],anchor?:ChatTurn,neighbor?:ChatTurn){
 if(!anchor)return -1;
 const matches=(left:ChatTurn,right:ChatTurn)=>left.role===right.role&&left.markdown===right.markdown;
 const exact=turns.findIndex((turn,index)=>matches(turn,anchor)&&(!neighbor||Boolean(turns[index+1]&&matches(turns[index+1],neighbor))));
 return exact>=0?exact:turns.findIndex(turn=>matches(turn,anchor));
}
function formatHoverTimestamp(timestamp:number){
 const parts=hoverTimestampFormatter.formatToParts(timestamp);
 const value=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)?.value??"";
 return `${value("month")} ${value("day")}, ${value("hour")}:${value("minute")} ${value("dayPeriod")}`;
}

export function ChatTimeline({ session, output, outputOffset=0, outputCursor=0, following, activityExpanded = false, onOpenSubagent, onNavigate, initialPromptOverride, disableDurableTimestamps = false }: { session: Session; output: string; outputOffset?:number; outputCursor?:number; following?:boolean; activityExpanded?: boolean; onOpenSubagent?:(id:string,title:string)=>void; onNavigate?:()=>void; initialPromptOverride?:string; disableDurableTimestamps?:boolean }) {
  const running = ["starting", "running", "waiting"].includes(session.status);
  const initialPrompt=initialPromptOverride??(session.parent_session_id?"":session.prompt);
  const [history,setHistory]=useState<HistoryWindow|null>(null);
  const [visibleEnd,setVisibleEnd]=useState<number|null>(null);
  const [historyBusy,setHistoryBusy]=useState(false);
  const [historyError,setHistoryError]=useState("");
  const activeHistory=history?.sessionId===session.id&&following!==true?history:null;
  const decodedHistory=useMemo(()=>activeHistory?historyText(activeHistory):null,[activeHistory]);
  const source=decodedHistory??output;
  const sourcePrompt=activeHistory?(activeHistory.start===0?initialPrompt:""):(outputOffset===0?initialPrompt:"");
  useEffect(()=>{if(following===true){setHistory(null);setVisibleEnd(null);setHistoryError("");}},[following]);
  const [durable,setDurable]=useState<{sessionId:string;records:SessionTurnTime[]}|null>(null);
  useEffect(()=>{if(disableDurableTimestamps){setDurable(null);return;}let stale=false;void listSessionTurnTimes(session.id).then(records=>{if(!stale)setDurable({sessionId:session.id,records});}).catch(()=>{});return()=>{stale=true;};},[session.id,session.generation,session.status,disableDurableTimestamps]);
  const parser=useRef(createTranscriptParser(sourcePrompt,session.created_at));const previous=useRef("");const prompt=useRef(sourcePrompt);
  const historicalRunning=running&&(!activeHistory||activeHistory.end===activeHistory.liveEnd);
  const parsed=useMemo(()=>{if(prompt.current!==sourcePrompt||!source.startsWith(previous.current)){parser.current=createTranscriptParser(sourcePrompt,session.created_at);previous.current="";prompt.current=sourcePrompt;}parser.current.append(source.slice(previous.current.length));previous.current=source;return parser.current.snapshot(historicalRunning);},[source,sourcePrompt,historicalRunning,session.created_at]);
  const turns=useMemo(()=>!disableDurableTimestamps&&durable?.sessionId===session.id?withDurableTurnTimestamps(parsed,durable.records,session.generation):parsed,[parsed,durable,session.id,session.generation,disableDurableTimestamps]);
  const end=following===true?turns.length:Math.min(visibleEnd??turns.length,turns.length);
  const start=Math.max(0,end-80);
  const visibleTurns=turns.slice(start,end);
  const timeline=useRef<HTMLDivElement>(null);const jump=useRef<string|null>(null);
  const visibleSubagentIDs=[...new Set(visibleTurns.flatMap(turn=>turn.activities.filter(activity=>activity.kind==="subagent").map(activity=>activity.docId).filter((id):id is string=>Boolean(id))))].slice(-128);
  const visibleSubagentKey=visibleSubagentIDs.join(",");
  const [subagentSummaries,setSubagentSummaries]=useState<Record<string,SubagentSummary>>({});
  useEffect(()=>{
    if(!visibleSubagentKey){setSubagentSummaries({});return;}
    let active=true,busy=false,timer:number|undefined;
    const ids=visibleSubagentKey.split(",");
    const parentSettled=!["starting","running","waiting"].includes(session.status);
    const schedule=()=>{if(active&&timer===undefined)timer=window.setTimeout(()=>{timer=undefined;read();},1000);};
    const read=()=>{
      if(!active||busy||document.hidden)return;
      busy=true;
      void fetchSubagentSummaries(session.id,ids).then(items=>{
        if(!active)return;
        const next=Object.fromEntries(items.map(item=>[item.id,item]));
        setSubagentSummaries(current=>Object.keys(current).length===items.length&&items.every(item=>current[item.id]?.status===item.status&&current[item.id]?.child_thread_id===item.child_thread_id&&current[item.id]?.title===item.title)?current:next);
        // A child can outlive its parent. A new parent turn rechecks completed
        // children because the provider may reopen one for another assignment.
        if(!parentSettled||ids.some(id=>!next[id]||next[id].status==="running"))schedule();
      }).catch(()=>{schedule();}).finally(()=>{busy=false;});
    };
    const onVisibility=()=>{if(document.hidden){if(timer!==undefined)window.clearTimeout(timer);timer=undefined;}else read();};
    document.addEventListener("visibilitychange",onVisibility);
    read();
    return()=>{active=false;if(timer!==undefined)window.clearTimeout(timer);document.removeEventListener("visibilitychange",onVisibility);};
  },[session.id,session.status,session.generation,visibleSubagentKey]);
  useLayoutEffect(()=>{const scroll=timeline.current?.closest<HTMLElement>(".messages");if(!scroll)return;if(jump.current){if(jump.current==="__top__"){scroll.scrollTop=0;jump.current=null;return;}const target=timeline.current?.querySelector<HTMLElement>(`[data-message-id="${jump.current}"]`);if(target){scroll.scrollTo({top:scroll.scrollTop+target.getBoundingClientRect().top-scroll.getBoundingClientRect().top-24,behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});jump.current=null;}}else if(visibleEnd!==null)scroll.scrollTop=0;},[visibleEnd,activeHistory]);

  const readHistory=(window:HistoryWindow)=>{const text=historyText(window),reader=createTranscriptParser(window.start===0?initialPrompt:"",session.created_at);reader.append(text);return reader.snapshot(running&&window.end===window.liveEnd);};
  const showEarlier=async()=>{
   onNavigate?.();setHistoryError("");
   if(start>0){setVisibleEnd(Math.max(80,end-60));return;}
   const before=activeHistory?.start??outputCursor;
   if(before<=0||historyBusy)return;
   setHistoryBusy(true);
   try{
    let next=activeHistory;
    const targetBytes=next?transcriptPageBytes:Math.min(historyWindowBytes,new TextEncoder().encode(output).length+transcriptPageBytes);
    let added=0;
    while((!next||added<targetBytes)&&before-(next?added:0)>0){
     const cursor=next?.start??outputCursor;
     const page=await getTranscriptPage(session.id,cursor);
     if(page.cursor!==cursor||page.offset>=cursor)throw Error("Earlier history changed. Return to latest and try again.");
     const bytes=decodePage(page.data);
     if(bytes.length!==page.cursor-page.offset)throw Error("Earlier history was incomplete. Try again.");
     next={sessionId:session.id,start:page.offset,end:next?.end??cursor,liveEnd:next?.liveEnd??cursor,alignedStart:page.offset===0,bytes:next?joinPages(bytes,next.bytes):bytes};
     added+=bytes.length;
     if(page.offset===0||next.bytes.length>=historyWindowBytes)break;
    }
    if(!next)return;
    if(next.bytes.length>historyWindowBytes){
     const limit=historyWindowBytes;
     let cutoff=limit;while(cutoff>0&&next.bytes[cutoff-1]!==10)cutoff--;
     if(cutoff===0)throw Error("This transcript contains an oversized entry that cannot be paged safely.");
     next={...next,end:next.start+cutoff,bytes:next.bytes.slice(0,cutoff)};
    }
    const nextTurns=readHistory(next),anchor=anchoredTurnIndex(nextTurns,turns[start],turns[start+1]);
    setHistory(next);
    setVisibleEnd(Math.min(nextTurns.length,anchor<0?80:Math.max(80,anchor+20)));
   }catch(reason){setHistoryError(reason instanceof Error?reason.message:String(reason));}finally{setHistoryBusy(false);}
  };
  const showNewer=async()=>{
   setHistoryError("");
   if(end<turns.length){setVisibleEnd(Math.min(turns.length,end+60));return;}
   if(!activeHistory)return;
   if(activeHistory.end>=activeHistory.liveEnd){setHistory(null);setVisibleEnd(null);return;}
   setHistoryBusy(true);
   try{
    const target=Math.min(activeHistory.liveEnd,activeHistory.end+transcriptPageBytes);
    const page=await getTranscriptPage(session.id,target);
    if(page.cursor!==target||page.offset>activeHistory.end)throw Error("Newer history changed. Return to latest and try again.");
    const bytes=decodePage(page.data).slice(activeHistory.end-page.offset);
    let next:HistoryWindow={...activeHistory,end:target,bytes:joinPages(activeHistory.bytes,bytes)};
    if(next.bytes.length>historyWindowBytes){
     let cutoff=next.bytes.length-historyWindowBytes;while(cutoff<next.bytes.length&&next.bytes[cutoff-1]!==10)cutoff++;
     next={...next,start:next.start+cutoff,alignedStart:true,bytes:next.bytes.slice(cutoff)};
    }
    const nextTurns=readHistory(next),anchor=anchoredTurnIndex(nextTurns,turns[end-1]);
    setHistory(next);setVisibleEnd(Math.min(nextTurns.length,anchor<0?80:Math.max(80,anchor+61)));
   }catch(reason){setHistoryError(reason instanceof Error?reason.message:String(reason));}finally{setHistoryBusy(false);}
  };

  return (
    <div ref={timeline} className="chat-timeline" aria-live="polite">
      <MessageRail turns={turns} timeline={timeline} onJump={index=>{onNavigate?.();const target=turns[index];const row=timeline.current?.querySelector<HTMLElement>(`[data-message-id="${target.id}"]`),scroll=timeline.current?.closest<HTMLElement>(".messages");if(index===0){if(row&&scroll)scroll.scrollTop=0;else{jump.current="__top__";setVisibleEnd(Math.min(turns.length,60));}}else if(row&&scroll)scroll.scrollTo({top:scroll.scrollTop+row.getBoundingClientRect().top-scroll.getBoundingClientRect().top-24,behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});else{jump.current=target.id;setVisibleEnd(Math.min(turns.length,index+60));}}}/>
      {(start>0||Boolean(activeHistory?.start)||(!activeHistory&&outputOffset>0)||end<turns.length||activeHistory)&&<div className="history-navigation">
        {(start>0||Boolean(activeHistory?.start)||(!activeHistory&&outputOffset>0))&&<button className="load-earlier" disabled={historyBusy} onClick={()=>void showEarlier()}>{historyBusy?"Loading earlier messages…":"Show earlier messages"}</button>}
        {(end<turns.length||activeHistory)&&<button className="load-earlier" disabled={historyBusy} onClick={()=>void showNewer()}>{historyBusy?"Loading messages…":"Show newer messages"}</button>}
      </div>}
      {historyError&&<p className="history-error" role="alert">{historyError}</p>}
      {visibleTurns.map((turn) =>
        turn.role === "system" ? <div className="fork-seam" key={turn.id} role="note">Forked from <strong>{turn.markdown}</strong></div> : turn.role === "user" ? (
          <UserTurn key={turn.id} id={turn.id} text={turn.markdown} timestamp={turn.timestamp} />
        ) : (
          <AssistantTurn
            key={turn.id}
            session={session}
            markdown={turn.markdown}
            activities={turn.activities}
            segments={turn.segments}
            generatedImages={turn.generatedImages}
            streaming={Boolean(turn.streaming)}
            agent={session.agent}
            activityExpanded={activityExpanded}
            onOpenSubagent={onOpenSubagent}
            subagentSummaries={subagentSummaries}
            timestamp={turn.timestamp}
          />
        ),
      )}
    </div>
  );
}

const UserTurn=memo(function UserTurn({text,id,timestamp}:{text:string;id:string;timestamp?:number}){
 const review=parseReviewComments(text);const parsed=parseAttachments(review.text);
 const ref=useRef<HTMLDivElement>(null);
 const [long,setLong]=useState(false),[expanded,setExpanded]=useState(false);
 const [commentsOpen,setCommentsOpen]=useState(false);
 useLayoutEffect(()=>{
  const node=ref.current;if(!node)return;
  const measure=()=>setLong(node.scrollHeight>parseFloat(getComputedStyle(node).lineHeight)*5+1);
  const observer=new ResizeObserver(measure);observer.observe(node);measure();
  return()=>observer.disconnect();
 },[text]);
 return <article className="chat-user-turn" data-message-id={id}>{parsed.images.length>0&&<section className="user-attachments" aria-label="Message attachments">{parsed.images.map(image=><AttachmentImage key={image.id} image={image}/>)}</section>}{parsed.text&&<div><div ref={ref} className={`user-prompt-text ${!expanded?"folded":""}`}>{parsed.text}</div>{long&&<button className="user-prompt-fold" aria-label={expanded?"Collapse message":"Expand message"} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}><CaretDown className={expanded?"expanded":""}/></button>}</div>}{review.details.length>0&&<div className="message-review-comments"><button aria-label={`${review.details.length} review ${review.details.length===1?"comment":"comments"}`} aria-expanded={commentsOpen} onClick={()=>setCommentsOpen(value=>!value)}>{review.details.length} {review.details.length===1?"comment":"comments"}</button>{commentsOpen&&<ul>{review.details.map((detail,index)=><li key={index}><code>{detail.location}{detail.tag?` (${detail.tag})`:""}</code><span>{detail.body}</span></li>)}</ul>}</div>}<TurnMetadata timestamp={timestamp} text={parsed.text} side="user"/></article>;
});

const AssistantTurn=memo(function AssistantTurn({
  session,
  markdown,
  activities,
  segments,
  generatedImages,
  streaming,
  agent,
  activityExpanded,
  onOpenSubagent,
  subagentSummaries,
  timestamp,
}: {
  session: Session;
  markdown: string;
  activities: ChatActivity[];
  segments?: ChatSegment[];
  generatedImages: GeneratedImage[];
  streaming: boolean;
  agent: string;
  activityExpanded: boolean;
  onOpenSubagent?:(id:string,title:string)=>void;
  subagentSummaries:Record<string,SubagentSummary>;
  timestamp?:number;
}) {
  // The socket already coalesces provider deltas once per frame. Show the
  // actual delivered text rather than replaying a second, slower typewriter.
  const visibleMarkdown = markdown;
  const renderActivities=(items:ChatActivity[],key:string)=>{
    const questions=items.filter(activity=>activity.kind==="question");
    const subagents=items.filter(activity=>activity.kind==="subagent");
    const grouped=items.filter(activity=>activity.kind!=="question"&&activity.kind!=="subagent");
    return <div className="chat-activity-segment" key={key}>{questions.map(question=><div className="transcript-question" role="note" aria-label={`Question: ${question.title}`} key={question.id}><span className="transcript-question-icon"><ChatCircleDots/></span><strong>Question</strong><span>{question.status==="pending"?"Awaiting your answer…":question.title}</span></div>)}{subagents.map(activity=><SubagentCard key={activity.id} activity={activity} summary={activity.docId?subagentSummaries[activity.docId]:undefined} onOpen={onOpenSubagent}/>)}{grouped.length>0&&<ActivityGroup activities={grouped} streaming={streaming} expanded={activityExpanded}/>}</div>;
  };
  return (
    <article className="chat-assistant-turn">
      <header><span className="agent-avatar"><ProviderIcon provider={agent}/></span><strong>{agentLabel(agent)}</strong></header>
      {segments?.length?segments.map(segment=>segment.kind==="text"?<MarkdownMessage key={segment.id} session={session}>{segment.markdown}</MarkdownMessage>:renderActivities(segment.activities,segment.id)):<>{activities.length>0&&renderActivities(activities,"activity-fallback")}{visibleMarkdown&&<MarkdownMessage session={session}>{visibleMarkdown}</MarkdownMessage>}</>}
      {streaming&&!visibleMarkdown&&activities.length===0 ? (
        <div className="native-thinking"><SpinnerGap className="spin" /> Working through the task…</div>
      ) : null}
      {generatedImages.length>0&&<section className="generated-images" aria-label="Generated images">{generatedImages.map(image=><AttachmentImage key={image.id} image={{...image,path:""}} sourceURL={generatedImageMediaURL(session.id,image.id)} className="generated-image"/>)}</section>}
      {streaming && visibleMarkdown && <span className="streaming-cursor" aria-label="Streaming" />}
      {!streaming&&<TurnMetadata timestamp={timestamp} text={markdown} side="assistant"/>}
    </article>
  );
});

function SubagentCard({activity,summary,onOpen}:{activity:ChatActivity;summary?:SubagentSummary;onOpen?:(id:string,title:string)=>void}){
 const status=summary?.status??"running",linked=Boolean(summary?.child_thread_id&&onOpen);
 const stateLabel=activity.subagentState==="starting"?"Starting":activity.subagentState==="spawned"?"Spawned":activity.subagentState==="failed"?"Failed":status==="running"?"Working":status==="done"?"Done":status==="failed"?"Failed":"Interrupted";
 const content=<><span className="subagent-chip-icon"><ChatCircleDots/></span><strong>Agent</strong><span className="subagent-chip-title">{activity.title}</span><span className="subagent-chip-status">{stateLabel}</span></>;
 return linked?<button type="button" className="subagent-chip" aria-label={`Open agent ${activity.title}`} onClick={()=>onOpen?.(activity.docId!,activity.title)}>{content}</button>:<div className="subagent-chip" role="note" aria-label={`Agent ${activity.title}`}>{content}</div>;
}

function TurnMetadata({timestamp,text,side}:{timestamp?:number;text:string;side:"user"|"assistant"}){
 const [copied,setCopied]=useState(false),[failed,setFailed]=useState(false),timer=useRef<number|undefined>(undefined),mounted=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(timer.current!==undefined)window.clearTimeout(timer.current);};},[]);
 if(timestamp===undefined&&!text)return null;
 const formatted=timestamp===undefined?"":formatHoverTimestamp(timestamp);
 const copy=async()=>{try{await copyText(text);if(!mounted.current)return;setCopied(true);setFailed(false);if(timer.current!==undefined)window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>setCopied(false),1200);}catch{if(mounted.current)setFailed(true);}};
 return <div className={`message-meta ${side}`}><div className="message-meta-content">{timestamp!==undefined&&<time dateTime={new Date(timestamp).toISOString()}>{formatted}</time>}{text&&<button type="button" aria-label={failed?"Unable to copy message":copied?"Message copied":"Copy message"} title={failed?"Unable to copy":copied?"Copied":"Copy message"} onClick={()=>void copy()}>{copied?<Check/>:<Copy/>}</button>}</div></div>;
}

function ActivityGroup({ activities, streaming, expanded }: { activities: ChatActivity[]; streaming: boolean; expanded: boolean }) {
  const [open, setOpen] = useState(expanded);
  useEffect(() => setOpen(expanded), [expanded]);
  const summary=workSummary(activities);
  const notice = activities.filter(activity => activity.kind === "notice").at(-1);
  return (
    <details className={`activity-group ${streaming?"streaming":""}`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <CaretDown className="activity-caret" />
        <span>{notice?.title ?? summary}</span>
      </summary>
      <div className="activity-list">
        {activities.map(activity=><ActivityRow key={activity.id} activity={activity} streaming={streaming} expanded={expanded}/>)}
      </div>
    </details>
  );
}

function workSummary(activities:ChatActivity[]):string{
 const thoughts=activities.filter(activity=>activity.kind==="thinking").length;
 const commands=activities.filter(activity=>activity.kind==="command").length;
 const counts={edited:0,read:0,searched:0,fetched:0,todos:0,other:0};
 const editedPaths=new Set<string>();
 for(const activity of activities.filter(item=>item.kind==="tool")){
  const title=activity.title.toLowerCase();
  if(activity.operation||/^(edit|write|apply patch|changed files)/.test(title)){
   if(activity.paths?.length)for(const path of activity.paths)editedPaths.add(path);
   else counts.edited++;
  }
  else if(/^(read|open file)/.test(title))counts.read++;
  else if(/^(search|grep|glob|web search)/.test(title))counts.searched++;
  else if(/^(web fetch|fetch)/.test(title))counts.fetched++;
  else if(/^(todo|update plan)/.test(title))counts.todos++;
  else counts.other++;
 }
 counts.edited+=editedPaths.size;
 const failures=activities.filter(activity=>activity.failed).length;
 const plural=(count:number,single:string,many:string)=>`${count} ${count===1?single:many}`;
 const parts:string[]=[];
 if(thoughts)parts.push(thoughts===1?"Thought process":`Thought ${thoughts} times`);
 if(commands)parts.push(`Ran ${plural(commands,"command","commands")}`);
 if(counts.edited)parts.push(`edited ${plural(counts.edited,"file","files")}`);
 if(counts.read)parts.push(`read ${plural(counts.read,"file","files")}`);
 if(counts.searched)parts.push(`searched ${plural(counts.searched,"time","times")}`);
 if(counts.fetched)parts.push(`fetched ${plural(counts.fetched,"page","pages")}`);
 if(counts.todos)parts.push("updated todos");
 if(counts.other)parts.push(`called ${plural(counts.other,"tool","tools")}`);
 if(failures)parts.push(`${failures} failed`);
 return parts.join(" · ").replace(/^./,letter=>letter.toUpperCase())||"Activity";
}

function ActivityRow({activity,streaming,expanded}:{activity:ChatActivity;streaming:boolean;expanded:boolean}){
 const [manual,setManual]=useState<boolean|null>(null);
 const detailOpen=manual??(activity.kind==="thinking"&&streaming&&expanded);
 return <div className="activity-row"><span className={`activity-icon ${activity.kind}`}>{activityIcon(activity)}</span>{activity.detail?<div className="activity-detail"><button type="button" aria-expanded={detailOpen} onClick={()=>setManual(!detailOpen)}>{activity.title}<CaretDown/></button>{detailOpen&&<pre>{activity.detail}</pre>}</div>:<strong>{activity.title}</strong>}</div>;
}

function activityIcon(activity: ChatActivity) {
  if (activity.kind === "thinking") return <ChatCircleDots />;
  if (activity.kind === "command") return <TerminalWindow />;
  if (activity.kind === "tool") return <Wrench />;
  return <Lightning />;
}

function agentLabel(agent: string): string {
  return ({ claude: "Claude Code", codex: "Codex CLI", cursor: "Cursor", copilot: "Copilot", opencode: "OpenCode" } as Record<string, string>)[agent] ?? agent;
}
