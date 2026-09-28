import {SyntaxText} from "./SyntaxText";
import {CommentSide,ReviewComment,ReviewCommentCard,ReviewCommentDraft} from "./ReviewComments";
import {Preferences,loadPreferences,savePreferences} from "./preferences";
import { Select } from "./Select";
import { ArrowClockwise, FileCode, GitDiff, CaretDown, CaretUp, Columns, Rows, ArrowsIn, TextAlignLeft, Plus } from "@phosphor-icons/react";
import { Fragment,Dispatch,SetStateAction,useEffect, useMemo, useState } from "react";
import { commitChanges, getDiff, stageFile } from "./api";

interface DiffFile {
  path: string;
  oldPath?: string;
  status: "A" | "M" | "D";
  lines: string[];
}

type Draft={path:string;side:CommentSide;line:number;oldPath?:string;editing?:string;value:string};
type CommentProps={comments:ReviewComment[];onComments:Dispatch<SetStateAction<ReviewComment[]>>};
export function ReviewWorkspace({sessionId,git=true,preferences,onPreferences,comments=[],onComments}:{sessionId:string;git?:boolean;preferences?:Preferences;onPreferences?:(next:Preferences)=>void;comments?:ReviewComment[];onComments?:CommentProps["onComments"]}){return git?<GitReviewWorkspace sessionId={sessionId} preferences={preferences} onPreferences={onPreferences} comments={comments} onComments={onComments}/>:<div className="panel-empty"><GitDiff/><strong>Folder workspace</strong><p>Git diffs and staging are available in Git projects.</p></div>;}
function GitReviewWorkspace({ sessionId,preferences,onPreferences,comments,onComments }: { sessionId: string;preferences?:Preferences;onPreferences?:(next:Preferences)=>void;comments:ReviewComment[];onComments?:CommentProps["onComments"] }) {
  const [diffScope,setDiffScope] = useState<"branch"|"working"|"staged"|"turn">("working");
  const [saved,setSaved]=useState(loadPreferences);const current=preferences||saved;const split=current.diff_split;const wrap=current.diff_wrap;const update=(key:"diff_split"|"diff_wrap",value:boolean)=>{const next={...current,[key]:value};if(onPreferences)onPreferences(next);else{setSaved(next);savePreferences(next);}};const [folded,setFolded]=useState(false);const [fileIndex,setFileIndex]=useState(0);
  const [version,setVersion] = useState(0);
  const [commitOpen,setCommitOpen]=useState(false);const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
  const [diff, setDiff] = useState("");
  const [draft,setDraft]=useState<Draft|null>(null);
  const commitDraft=()=>{if(!draft?.value.trim()||!onComments)return;const body=draft.value.trim();onComments(current=>draft.editing?current.map(comment=>comment.id===draft.editing?{...comment,body}:comment):[...current,{id:crypto.randomUUID(),path:draft.path,oldPath:draft.oldPath,source:"diff",side:draft.side,line:draft.line,body}]);setDraft(null);};
  const editComment=(comment:ReviewComment)=>setDraft({path:comment.path,oldPath:comment.oldPath,side:comment.side??"new",line:comment.line,editing:comment.id,value:comment.body});
  const removeComment=(id:string)=>onComments?.(current=>current.filter(comment=>comment.id!==id));


  const [query, setQuery] = useState("");

  const [error, setError] = useState<string | null>(null);
  const changed = useMemo(() => parseUnifiedDiff(diff), [diff]);
  const filtered=useMemo(()=>changed.filter(file=>file.path.toLowerCase().includes(query.toLowerCase())),[changed,query]);

  useEffect(() => {
    let stale = false;
    setError(null);

    const refresh=()=>getDiff(sessionId,diffScope)
      .then((nextDiff) => {
        if (stale) return;
        setError(null);
        setDiff(nextDiff);

      })
      .catch((reason) => {
        if (!stale) setError(reason instanceof Error ? reason.message : String(reason));
      });
    void refresh();
    const timer=window.setInterval(()=>void refresh(),1800);
    return () => { stale = true; window.clearInterval(timer); };
  }, [sessionId,diffScope,version]);

  return (
    <section className={`review-workspace zeron-diffs ${commitOpen?"commit-open":""} ${wrap?"wrap-diffs":""}`}>
      <header className="diff-toolbar"><Select aria-label="Diff scope" value={diffScope} onChange={event=>setDiffScope(event.target.value as "working"|"branch"|"staged"|"turn")}><option value="working">Working tree</option><option value="branch">Branch changes</option><option value="turn">Latest turn</option><option value="staged">Staged changes</option></Select><input aria-label="Filter diffs" placeholder="Filter files" value={query} onChange={event=>setQuery(event.target.value)}/><button aria-label="Refresh changes" onClick={()=>setVersion(value=>value+1)}><ArrowClockwise/></button><button aria-label={split?"Show unified diff":"Show split diff"} aria-pressed={split} onClick={()=>update("diff_split",!split)}>{split?<Rows/>:<Columns/>}</button><button aria-label="Wrap diff lines" aria-pressed={wrap} onClick={()=>update("diff_wrap",!wrap)}><TextAlignLeft/></button><button aria-label={folded?"Expand all diffs":"Fold all diffs"} onClick={()=>setFolded(v=>!v)}><ArrowsIn/></button><button aria-label="Previous changed file" disabled={!filtered.length} onClick={()=>{const next=(fileIndex-1+filtered.length)%filtered.length;setFileIndex(next);document.getElementById(`diff-file-${next}`)?.scrollIntoView({block:"start"});}}><CaretUp/></button><button aria-label="Next changed file" disabled={!filtered.length} onClick={()=>{const next=(fileIndex+1)%filtered.length;setFileIndex(next);document.getElementById(`diff-file-${next}`)?.scrollIntoView({block:"start"});}}><CaretDown/></button><button onClick={()=>setCommitOpen(value=>!value)} disabled={!changed.length}>Commit</button></header>
      {commitOpen&&<form className="commit-form" onSubmit={event=>{event.preventDefault();setBusy(true);void commitChanges(sessionId,message,diffScope==="staged").then(()=>{setCommitOpen(false);setMessage("");setVersion(value=>value+1);}).catch(reason=>setError(String(reason))).finally(()=>setBusy(false));}}><input aria-label="Commit message" placeholder="Commit message" value={message} onChange={event=>setMessage(event.target.value)}/><button disabled={!message.trim()||busy}>{diffScope==="staged"?"Commit staged changes":"Commit all changes"}</button><button type="button" onClick={()=>setCommitOpen(false)}>Cancel</button></form>}
      <div className="diff-summary">{changed.length} {diffScope==="working"?"uncommitted changes":"changed files"}<span className="diff-added">+{changed.reduce((count,file)=>count+file.lines.filter(line=>line.startsWith("+")).length,0)}</span><span className="diff-removed">−{changed.reduce((count,file)=>count+file.lines.filter(line=>line.startsWith("-")).length,0)}</span></div>
      <div className="diff-view">{error?<div className="inline-error">{error}</div>:filtered.length?filtered.map((file,index)=><DiffDocument file={file} key={file.path} index={index} split={split} folded={folded} stage={diffScope==="working"||diffScope==="staged"?()=>{setBusy(true);void stageFile(sessionId,file.path,diffScope!=="staged").then(()=>setVersion(v=>v+1)).catch(reason=>setError(String(reason))).finally(()=>setBusy(false));}:undefined} staged={diffScope==="staged"} busy={busy} comments={comments.filter(comment=>comment.source==="diff"&&comment.path===file.path)} draft={draft?.path===file.path?draft:null} onDraft={setDraft} onCommit={commitDraft} onEdit={editComment} onRemove={removeComment} commentable={Boolean(onComments)}/>):<div className="panel-empty"><GitDiff/><strong>{changed.length?"No matching files":`No ${{working:"uncommitted",branch:"branch",staged:"staged",turn:"latest-turn"}[diffScope]} changes`}</strong><p>{changed.length?"Try another file name.":diffScope==="staged"?"Stage a changed file to review it here.":"Changes appear here as the agent works."}</p></div>}</div>
    </section>
  );
}

function DiffLineNumber({path,number,side,onAdd}:{path:string;number?:number;side:CommentSide;onAdd?:()=>void}){
 return <span className="diff-comment-number">{number||""}{number&&onAdd&&<button type="button" aria-label={`Add comment on ${side} line ${number} of ${path}`} onClick={onAdd}><Plus/></button>}</span>;
}

function DiffDocument({file,index,split,folded,stage,staged,busy,comments,draft,onDraft,onCommit,onEdit,onRemove,commentable}:{file:DiffFile;index:number;split:boolean;folded:boolean;stage?:()=>void;staged:boolean;busy:boolean;comments:ReviewComment[];draft:Draft|null;onDraft:Dispatch<SetStateAction<Draft|null>>;onCommit:()=>void;onEdit:(comment:ReviewComment)=>void;onRemove:(id:string)=>void;commentable:boolean}){
 const [open,setOpen]=useState(!folded);useEffect(()=>setOpen(!folded),[folded]);
 const language=file.path.split(".").at(-1)??"";const syntax=file.lines.length<=2000;
 const content=(line:string)=>{const text=/^[ +\-]/.test(line)?line.slice(1)||" ":line||" ";return syntax?<SyntaxText text={text} language={language}/>:text;};
 let old=0,next=0;const rows=file.lines.filter(line=>!line.startsWith("\\ No newline at end of file")&&!/^((new|deleted) file mode|similarity index|rename (from|to))/.test(line)).map(line=>{if(line.startsWith("@@")){const match=line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);old=Number(match?.[1]||0);next=Number(match?.[2]||0);return {line,hunk:true,oldNo:undefined as number|undefined,newNo:undefined as number|undefined,kind:"hunk"};}const add=line.startsWith("+"),remove=line.startsWith("-");return {line,hunk:false,oldNo:add?undefined:old++,newNo:remove?undefined:next++,kind:add?"addition":remove?"deletion":"context"};});
 const begin=(side:CommentSide,line:number)=>onDraft({path:file.path,oldPath:file.oldPath,side,line,value:""});
 return <article id={`diff-file-${index}`} className={`diff-document ${split?"split-diff":""}`}><header><button className="diff-fold" aria-label={`${open?"Fold":"Expand"} ${file.path}`} aria-expanded={open} onClick={()=>setOpen(v=>!v)}><CaretDown style={{transform:open?undefined:"rotate(-90deg)"}}/></button><FileCode/><strong>{file.path}</strong><span className={`file-status status-${file.status.toLowerCase()}`}>{file.status}</span>{stage&&<button disabled={busy} className="stage-file" onClick={stage}>{staged?"Unstage":"Stage"}</button>}</header>{open&&<div className="diff-lines">{rows.map((row,i)=>{
   const attached=comments.filter(comment=>comment.side==="old"?comment.line===row.oldNo:comment.line===row.newNo);
   const draftHere=draft&&((draft.side==="old"&&draft.line===row.oldNo)||(draft.side==="new"&&draft.line===row.newNo));
   return <Fragment key={i}>{split&&!row.hunk?<div className={`diff-split-line ${row.kind}`}><DiffLineNumber path={file.path} number={row.oldNo} side="old" onAdd={commentable&&row.oldNo?()=>begin("old",row.oldNo!):undefined}/><code className="old-code">{row.kind==="addition"?"":content(row.line)}</code><DiffLineNumber path={file.path} number={row.newNo} side="new" onAdd={commentable&&row.newNo?()=>begin("new",row.newNo!):undefined}/><code className="new-code">{row.kind==="deletion"?"":content(row.line)}</code></div>:<div className={`diff-line ${row.kind}`}><DiffLineNumber path={file.path} number={row.oldNo} side="old" onAdd={commentable&&row.oldNo?()=>begin("old",row.oldNo!):undefined}/><DiffLineNumber path={file.path} number={row.newNo} side="new" onAdd={commentable&&row.newNo?()=>begin("new",row.newNo!):undefined}/><code>{row.hunk||!syntax||!/^([ +\-])/.test(row.line)?row.line||" ":<>{row.line[0]}{content(row.line)}</>}</code></div>}{attached.filter(comment=>comment.id!==draft?.editing).map(comment=><ReviewCommentCard key={comment.id} comment={comment} onEdit={()=>onEdit(comment)} onRemove={()=>onRemove(comment.id)}/>)}{draftHere&&<ReviewCommentDraft path={draft.side==="old"?draft.oldPath||draft.path:draft.path} line={draft.line} value={draft.value} onChange={value=>onDraft(current=>current?{...current,value}:null)} onSave={onCommit} onCancel={()=>onDraft(null)}/>}</Fragment>;
  })}</div>}</article>;
}

export function parseUnifiedDiff(value: string): DiffFile[] {
  if (!value.trim()) return [];
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  for (const line of value.replace(/\r/g, "").split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current) files.push(current);
      const path = line.match(/ b\/(.+)$/)?.[1] ?? "unknown";
      current = { path, status: "M", lines: [] };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("new file mode")) current.status = "A";
    if (line.startsWith("deleted file mode")) current.status = "D";
    if (line.startsWith("rename from ")) current.oldPath = line.slice("rename from ".length);
    if (!line.startsWith("index ") && !line.startsWith("--- ") && !line.startsWith("+++ ")) current.lines.push(line);
  }
  if (current) files.push(current);
  return files;
}
