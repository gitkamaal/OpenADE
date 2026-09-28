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
import { memo, useLayoutEffect, useEffect, useRef, useState } from "react";
import { fetchSubagentSummaries, generatedImageMediaURL, listSessionTurnTimes, Session, SessionTurnTime, SubagentSummary } from "./api";
import { ChatActivity, GeneratedImage, createTranscriptParser, withDurableTurnTimestamps } from "./chat-model";
import { MarkdownMessage } from "./MarkdownMessage";
import { parseReviewComments } from "./ReviewComments";

const hoverTimestampFormatter=new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:true});
function formatHoverTimestamp(timestamp:number){
 const parts=hoverTimestampFormatter.formatToParts(timestamp);
 const value=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)?.value??"";
 return `${value("month")} ${value("day")}, ${value("hour")}:${value("minute")} ${value("dayPeriod")}`;
}

export function ChatTimeline({ session, output, activityExpanded = false, onOpenSubagent, initialPromptOverride, disableDurableTimestamps = false }: { session: Session; output: string; activityExpanded?: boolean; onOpenSubagent?:(id:string,title:string)=>void; initialPromptOverride?:string; disableDurableTimestamps?:boolean }) {
  const running = ["starting", "running", "waiting"].includes(session.status);
  const initialPrompt=initialPromptOverride??(session.parent_session_id?"":session.prompt);
  const [durable,setDurable]=useState<{sessionId:string;records:SessionTurnTime[]}|null>(null);
  useEffect(()=>{if(disableDurableTimestamps){setDurable(null);return;}let stale=false;void listSessionTurnTimes(session.id).then(records=>{if(!stale)setDurable({sessionId:session.id,records});}).catch(()=>{});return()=>{stale=true;};},[session.id,session.generation,session.status,disableDurableTimestamps]);
  const parser=useRef(createTranscriptParser(initialPrompt,session.created_at));const previous=useRef("");const prompt=useRef(initialPrompt);
  if(prompt.current!==initialPrompt||!output.startsWith(previous.current)){parser.current=createTranscriptParser(initialPrompt,session.created_at);previous.current="";prompt.current=initialPrompt;}
  parser.current.append(output.slice(previous.current.length));previous.current=output;
  const parsed=parser.current.snapshot(running);
  const turns=!disableDurableTimestamps&&durable?.sessionId===session.id?withDurableTurnTimestamps(parsed,durable.records,session.generation):parsed;
  const [visibleCount,setVisibleCount]=useState(80);const timeline=useRef<HTMLDivElement>(null);const jump=useRef<string|null>(null);
  const visibleSubagentIDs=[...new Set(turns.slice(-visibleCount).flatMap(turn=>turn.activities.filter(activity=>activity.kind==="subagent").map(activity=>activity.docId).filter((id):id is string=>Boolean(id))))].slice(-128);
  const visibleSubagentKey=visibleSubagentIDs.join(",");
  const [subagentSummaries,setSubagentSummaries]=useState<Record<string,SubagentSummary>>({});
  useEffect(()=>{if(!visibleSubagentKey){setSubagentSummaries({});return;}let active=true,busy=false;const ids=visibleSubagentKey.split(",");const read=()=>{if(busy)return;busy=true;void fetchSubagentSummaries(session.id,ids).then(items=>{if(!active)return;const next=Object.fromEntries(items.map(item=>[item.id,item]));setSubagentSummaries(current=>Object.keys(current).length===items.length&&items.every(item=>current[item.id]?.status===item.status&&current[item.id]?.child_thread_id===item.child_thread_id&&current[item.id]?.title===item.title)?current:next);}).catch(()=>{}).finally(()=>{busy=false;});};read();const timer=window.setInterval(()=>{if(!document.hidden)read();},1000);return()=>{active=false;window.clearInterval(timer);};},[session.id,visibleSubagentKey]);
  useLayoutEffect(()=>{if(!jump.current)return;const target=timeline.current?.querySelector<HTMLElement>(`[data-message-id="${jump.current}"]`),scroll=timeline.current?.closest<HTMLElement>(".messages");if(target&&scroll){scroll.scrollTo({top:scroll.scrollTop+target.getBoundingClientRect().top-scroll.getBoundingClientRect().top-24,behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});jump.current=null;}},[visibleCount]);

  return (
    <div ref={timeline} className="chat-timeline" aria-live="polite">
      <MessageRail turns={turns} timeline={timeline} onJump={index=>{const target=turns[index];const row=timeline.current?.querySelector<HTMLElement>(`[data-message-id="${target.id}"]`),scroll=timeline.current?.closest<HTMLElement>(".messages");if(row&&scroll)scroll.scrollTo({top:scroll.scrollTop+row.getBoundingClientRect().top-scroll.getBoundingClientRect().top-24,behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});else{jump.current=target.id;setVisibleCount(current=>Math.max(current,turns.length-index));}}}/>
      {turns.length>visibleCount&&<button className="load-earlier" onClick={()=>setVisibleCount(count=>count+80)}>Show earlier messages</button>}
      {turns.slice(-visibleCount).map((turn) =>
        turn.role === "system" ? <div className="fork-seam" key={turn.id} role="note">Forked from <strong>{turn.markdown}</strong></div> : turn.role === "user" ? (
          <UserTurn key={turn.id} id={turn.id} text={turn.markdown} timestamp={turn.timestamp} />
        ) : (
          <AssistantTurn
            key={turn.id}
            session={session}
            markdown={turn.markdown}
            activities={turn.activities}
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
  generatedImages: GeneratedImage[];
  streaming: boolean;
  agent: string;
  activityExpanded: boolean;
  onOpenSubagent?:(id:string,title:string)=>void;
  subagentSummaries:Record<string,SubagentSummary>;
  timestamp?:number;
}) {
  const visibleMarkdown = useProgressiveMarkdown(markdown, streaming);
  const questions=activities.filter(activity=>activity.kind==="question");
  const subagents=activities.filter(activity=>activity.kind==="subagent");
  const grouped=activities.filter(activity=>activity.kind!=="question"&&activity.kind!=="subagent");
  return (
    <article className="chat-assistant-turn">
      <header><span className="agent-avatar"><ProviderIcon provider={agent}/></span><strong>{agentLabel(agent)}</strong></header>
      {questions.map(question=><div className="transcript-question" role="note" aria-label={`Question: ${question.title}`} key={question.id}><span className="transcript-question-icon"><ChatCircleDots/></span><strong>Question</strong><span>{question.status==="pending"?"Awaiting your answer…":question.title}</span></div>)}
      {subagents.map(activity=><SubagentCard key={activity.id} activity={activity} summary={activity.docId?subagentSummaries[activity.docId]:undefined} onOpen={onOpenSubagent}/>)}
      {grouped.length > 0 && <ActivityGroup activities={grouped} streaming={streaming} expanded={activityExpanded} />}
      {visibleMarkdown ? <MarkdownMessage session={session}>{visibleMarkdown}</MarkdownMessage> : streaming ? (
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
  const [open, setOpen] = useState(expanded && !streaming);
  useEffect(() => setOpen(streaming ? false : expanded), [expanded, streaming]);
  const toolCount = activities.filter(activity => activity.kind === "command" || activity.kind === "tool").length;
  const thought = activities.some(activity => activity.kind === "thinking");
  const summary = toolCount ? `${toolCount} tool${toolCount===1?"":"s"}${thought?" · Thought":""}` : thought ? "Thought" : "Activity";
  const notice = activities.filter(activity => activity.kind === "notice").at(-1);
  return (
    <details className="activity-group" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {streaming ? <SpinnerGap className="spin" /> : <Check />}
        <span>{streaming ? activities.at(-1)?.title ?? "Working" : notice?.title ?? summary}</span>
        <CaretDown className="activity-caret" />
      </summary>
      <div className="activity-list">
        {activities.map((activity) => (
          <div className="activity-row" key={activity.id}>
            <span className={`activity-icon ${activity.kind}`}>{activityIcon(activity)}</span>
            {activity.detail ? <details className="activity-detail"><summary>{activity.title}</summary><pre>{activity.detail}</pre></details> : <strong>{activity.title}</strong>}
          </div>
        ))}
      </div>
    </details>
  );
}

function useProgressiveMarkdown(markdown: string, streaming: boolean): string {
  const [visible, setVisible] = useState(streaming ? "" : markdown);

  useEffect(() => {
    if (!streaming) {
      setVisible(markdown);
      return;
    }
    if (!markdown.startsWith(visible)) {
      setVisible("");
    }
  }, [markdown, streaming, visible]);

  useEffect(() => {
    if (!streaming || visible.length >= markdown.length) return;
    const remaining = markdown.length - visible.length;
    const step = Math.max(2, Math.min(28, Math.ceil(remaining / 18)));
    const timer = window.setTimeout(() => {
      setVisible(markdown.slice(0, Math.min(markdown.length, visible.length + step)));
    }, 18);
    return () => window.clearTimeout(timer);
  }, [markdown, streaming, visible]);

  return visible;
}

function activityIcon(activity: ChatActivity) {
  if (activity.kind === "command") return <TerminalWindow />;
  if (activity.kind === "tool") return <Wrench />;
  return <Lightning />;
}

function agentLabel(agent: string): string {
  return ({ claude: "Claude Code", codex: "Codex CLI", cursor: "Cursor", copilot: "Copilot", opencode: "OpenCode" } as Record<string, string>)[agent] ?? agent;
}
