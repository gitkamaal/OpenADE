import {MessageRail} from "./MessageRail";
import {parseAttachments,AttachmentImage} from "./Attachments";
import { ProviderIcon } from "./ProviderIcon";
import { copyText } from "./clipboard";
import {
  CaretDown,
  Check,
  Copy,
  Lightning,
  SpinnerGap,
  TerminalWindow,
  Wrench,
} from "@phosphor-icons/react";
import { memo, useLayoutEffect, useEffect, useRef, useState } from "react";
import { Session } from "./api";
import { ChatActivity, createTranscriptParser } from "./chat-model";
import { MarkdownMessage } from "./MarkdownMessage";

export function ChatTimeline({ session, output, activityExpanded = false }: { session: Session; output: string; activityExpanded?: boolean }) {
  const running = ["starting", "running", "waiting"].includes(session.status);
  const parser=useRef(createTranscriptParser(session.prompt));const previous=useRef("");const prompt=useRef(session.prompt);
  if(prompt.current!==session.prompt||!output.startsWith(previous.current)){parser.current=createTranscriptParser(session.prompt);previous.current="";prompt.current=session.prompt;}
  parser.current.append(output.slice(previous.current.length));previous.current=output;
  const turns=parser.current.snapshot(running);
  const [visibleCount,setVisibleCount]=useState(80);const timeline=useRef<HTMLDivElement>(null);const jump=useRef<string|null>(null);
  useLayoutEffect(()=>{if(!jump.current)return;const target=timeline.current?.querySelector<HTMLElement>(`[data-message-id="${jump.current}"]`),scroll=timeline.current?.closest<HTMLElement>(".messages");if(target&&scroll){scroll.scrollTo({top:scroll.scrollTop+target.getBoundingClientRect().top-scroll.getBoundingClientRect().top-24,behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});jump.current=null;}},[visibleCount]);

  return (
    <div ref={timeline} className="chat-timeline" aria-live="polite">
      <MessageRail turns={turns} timeline={timeline} onJump={index=>{const target=turns[index];const row=timeline.current?.querySelector<HTMLElement>(`[data-message-id="${target.id}"]`),scroll=timeline.current?.closest<HTMLElement>(".messages");if(row&&scroll)scroll.scrollTo({top:scroll.scrollTop+row.getBoundingClientRect().top-scroll.getBoundingClientRect().top-24,behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});else{jump.current=target.id;setVisibleCount(current=>Math.max(current,turns.length-index));}}}/>
      {turns.length>visibleCount&&<button className="load-earlier" onClick={()=>setVisibleCount(count=>count+80)}>Show earlier messages</button>}
      {turns.slice(-visibleCount).map((turn) =>
        turn.role === "user" ? (
          <UserTurn key={turn.id} id={turn.id} text={turn.markdown} />
        ) : (
          <AssistantTurn
            key={turn.id}
            session={session}
            markdown={turn.markdown}
            activities={turn.activities}
            streaming={Boolean(turn.streaming)}
            agent={session.agent}
            activityExpanded={activityExpanded}
          />
        ),
      )}
    </div>
  );
}

const UserTurn=memo(function UserTurn({text,id}:{text:string;id:string}){
 const parsed=parseAttachments(text);
 const ref=useRef<HTMLDivElement>(null);
 const [long,setLong]=useState(false),[expanded,setExpanded]=useState(false);
 useLayoutEffect(()=>{
  const node=ref.current;if(!node)return;
  const measure=()=>setLong(node.scrollHeight>parseFloat(getComputedStyle(node).lineHeight)*5+1);
  const observer=new ResizeObserver(measure);observer.observe(node);measure();
  return()=>observer.disconnect();
 },[text]);
 return <article className="chat-user-turn" data-message-id={id}>{parsed.images.length>0&&<section className="user-attachments" aria-label="Message attachments">{parsed.images.map(image=><AttachmentImage key={image.id} image={image}/>)}</section>}{parsed.text&&<div><div ref={ref} className={`user-prompt-text ${!expanded?"folded":""}`}>{parsed.text}</div>{long&&<button className="user-prompt-fold" aria-label={expanded?"Collapse message":"Expand message"} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}><CaretDown className={expanded?"expanded":""}/></button>}</div>}</article>;
});

const AssistantTurn=memo(function AssistantTurn({
  session,
  markdown,
  activities,
  streaming,
  agent,
  activityExpanded,
}: {
  session: Session;
  markdown: string;
  activities: ChatActivity[];
  streaming: boolean;
  agent: string;
  activityExpanded: boolean;
}) {
  const [copied, setCopied] = useState(false);
 const [copyFailed,setCopyFailed]=useState(false);
  const copyTimerRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(false);
  const visibleMarkdown = useProgressiveMarkdown(markdown, streaming);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copyTimerRef.current !== undefined) window.clearTimeout(copyTimerRef.current);
    };
  }, []);
  const copy = async () => {
    try{await copyText(markdown);}catch{if(mountedRef.current)setCopyFailed(true);return;}
 setCopyFailed(false);
    if (!mountedRef.current) return;
    setCopied(true);
    if (copyTimerRef.current !== undefined) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = undefined;
      setCopied(false);
    }, 1200);
  };
  return (
    <article className="chat-assistant-turn">
      <header><span className="agent-avatar"><ProviderIcon provider={agent}/></span><strong>{agentLabel(agent)}</strong></header>
      {activities.length > 0 && <ActivityGroup activities={activities} streaming={streaming} expanded={activityExpanded} />}
      {visibleMarkdown ? <MarkdownMessage session={session}>{visibleMarkdown}</MarkdownMessage> : streaming ? (
        <div className="native-thinking"><SpinnerGap className="spin" /> Working through the task…</div>
      ) : null}
      {streaming && visibleMarkdown && <span className="streaming-cursor" aria-label="Streaming" />}
      {markdown && !streaming && (
        <div className="response-actions">
          <button type="button" onClick={() => void copy()}>{copied ? <Check /> : <Copy />}<span>{copyFailed?"Unable to copy":copied ? "Copied" : "Copy"}</span></button>
        </div>
      )}
    </article>
  );
});

function ActivityGroup({ activities, streaming, expanded }: { activities: ChatActivity[]; streaming: boolean; expanded: boolean }) {
  const [open, setOpen] = useState(expanded && !streaming);
  useEffect(() => setOpen(streaming ? false : expanded), [expanded, streaming]);
  const toolCount = activities.filter(activity => activity.kind === "command" || activity.kind === "tool").length;
  const notice = activities.filter(activity => activity.kind === "notice").at(-1);
  return (
    <details className="activity-group" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {streaming ? <SpinnerGap className="spin" /> : <Check />}
        <span>{streaming ? activities.at(-1)?.title ?? "Working" : notice?.title ?? `${toolCount} tool${toolCount===1?"":"s"}${activities.some(a=>a.kind==="thinking")?" · Thought":""}`}</span>
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
  return ({ claude: "Claude Code", codex: "Codex CLI", copilot: "Copilot", opencode: "OpenCode" } as Record<string, string>)[agent] ?? agent;
}
