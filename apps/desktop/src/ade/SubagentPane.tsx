import {useEffect,useRef,useState} from "react";
import {ChatTimeline} from "./ChatTimeline";
import {fetchSubagent,Session,SubagentDoc} from "./api";

export function SubagentPane({session,docId,expanded,onTitle}:{session:Session;docId:string;expanded:boolean;onTitle:(title:string)=>void}){
 const [doc,setDoc]=useState<SubagentDoc|null>(null),[error,setError]=useState("");
 const messages=useRef<HTMLDivElement>(null),following=useRef(true),cursor=useRef(0);
 const onTitleRef=useRef(onTitle);onTitleRef.current=onTitle;
 useEffect(()=>{let active=true,busy=false,terminal=false,tick=0;cursor.current=0;setDoc(null);setError("");const read=()=>{if(busy)return;busy=true;const after=cursor.current;void fetchSubagent(session.id,docId,after).then(value=>{if(active){cursor.current=value.cursor;setDoc(previous=>({...value,output:after===0||value.reset?value.output:(previous?.output??"")+value.output}));onTitleRef.current(value.title);setError("");terminal=value.status!=="running";}}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:"Subagent transcript unavailable");}).finally(()=>{busy=false;});};read();const timer=window.setInterval(()=>{if(!document.hidden&&(!terminal||++tick%5===0))read();},1000);return()=>{active=false;window.clearInterval(timer);};},[session.id,docId]);
 useEffect(()=>{if(following.current)messages.current?.scrollTo({top:messages.current.scrollHeight,behavior:"auto"});},[doc?.output]);
 const status=doc?.status==="done"?"completed":doc?.status==="failed"?"failed":doc?.status==="interrupted"?"interrupted":"running";
 return <section className="subagent-pane" aria-label={`Agent transcript ${doc?.title??"loading"}`}><header><strong>{doc?.title??"Agent"}</strong><span className={`subagent-pane-status ${doc?.status??"running"}`}>{doc?.status??"Loading"}</span></header>{error&&<p className="inline-error" role="alert">{error}</p>}<div className="subagent-pane-messages messages" ref={messages} onScroll={event=>{const node=event.currentTarget;following.current=node.scrollHeight-node.scrollTop-node.clientHeight<80;}}>{doc?<ChatTimeline session={{...session,status}} output={doc.output} activityExpanded={expanded} initialPromptOverride="" disableDurableTimestamps/>:<p className="panel-empty">Loading agent transcript…</p>}</div></section>;
}
