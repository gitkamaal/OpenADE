import { Select } from "./Select";
import { ArrowClockwise, FileCode, GitDiff, CaretDown, CaretUp, Columns, Rows, ArrowsIn } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { commitChanges, getDiff, stageFile } from "./api";

interface DiffFile {
  path: string;
  status: "A" | "M" | "D";
  lines: string[];
}

export function ReviewWorkspace({ sessionId }: { sessionId: string }) {
  const [diffScope,setDiffScope] = useState<"branch"|"working"|"staged"|"turn">("working");
  const [split,setSplit]=useState(false);const [folded,setFolded]=useState(false);const [fileIndex,setFileIndex]=useState(0);
  const [version,setVersion] = useState(0);
  const [commitOpen,setCommitOpen]=useState(false);const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
  const [diff, setDiff] = useState("");


  const [query, setQuery] = useState("");

  const [error, setError] = useState<string | null>(null);
  const changed = useMemo(() => parseUnifiedDiff(diff), [diff]);

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
    <section className={`review-workspace zeron-diffs ${commitOpen?"commit-open":""}`}>
      <header className="diff-toolbar"><Select aria-label="Diff scope" value={diffScope} onChange={event=>setDiffScope(event.target.value as "working"|"branch"|"staged"|"turn")}><option value="working">Working tree</option><option value="branch">Branch changes</option><option value="turn">Latest turn</option><option value="staged">Staged changes</option></Select><input aria-label="Filter diffs" placeholder="Filter files" value={query} onChange={event=>setQuery(event.target.value)}/><button aria-label="Refresh changes" onClick={()=>setVersion(value=>value+1)}><ArrowClockwise/></button><button aria-label={split?"Show unified diff":"Show split diff"} aria-pressed={split} onClick={()=>setSplit(v=>!v)}>{split?<Rows/>:<Columns/>}</button><button aria-label={folded?"Expand all diffs":"Fold all diffs"} onClick={()=>setFolded(v=>!v)}><ArrowsIn/></button><button aria-label="Previous changed file" disabled={!changed.length} onClick={()=>{const next=(fileIndex-1+changed.length)%changed.length;setFileIndex(next);document.getElementById(`diff-file-${next}`)?.scrollIntoView({block:"start"});}}><CaretUp/></button><button aria-label="Next changed file" disabled={!changed.length} onClick={()=>{const next=(fileIndex+1)%changed.length;setFileIndex(next);document.getElementById(`diff-file-${next}`)?.scrollIntoView({block:"start"});}}><CaretDown/></button><button onClick={()=>setCommitOpen(value=>!value)} disabled={!changed.length}>Commit</button></header>
      {commitOpen&&<form className="commit-form" onSubmit={event=>{event.preventDefault();setBusy(true);void commitChanges(sessionId,message,diffScope==="staged").then(()=>{setCommitOpen(false);setMessage("");setVersion(value=>value+1);}).catch(reason=>setError(String(reason))).finally(()=>setBusy(false));}}><input aria-label="Commit message" placeholder="Commit message" value={message} onChange={event=>setMessage(event.target.value)}/><button disabled={!message.trim()||busy}>{diffScope==="staged"?"Commit staged changes":"Commit all changes"}</button><button type="button" onClick={()=>setCommitOpen(false)}>Cancel</button></form>}
      <div className="diff-summary">{changed.length} {diffScope==="working"?"uncommitted changes":"changed files"}<span className="diff-added">+{changed.reduce((count,file)=>count+file.lines.filter(line=>line.startsWith("+")).length,0)}</span><span className="diff-removed">−{changed.reduce((count,file)=>count+file.lines.filter(line=>line.startsWith("-")).length,0)}</span></div>
      <div className="diff-view">{error?<div className="inline-error">{error}</div>:changed.length?changed.filter(file=>file.path.toLowerCase().includes(query.toLowerCase())).map((file,index)=><DiffDocument file={file} key={file.path} index={index} split={split} folded={folded} stage={diffScope==="working"||diffScope==="staged"?()=>{setBusy(true);void stageFile(sessionId,file.path,diffScope!=="staged").then(()=>setVersion(v=>v+1)).catch(reason=>setError(String(reason))).finally(()=>setBusy(false));}:undefined} staged={diffScope==="staged"} busy={busy}/>):<div className="panel-empty"><GitDiff/><strong>No {diffScope==="working"?"uncommitted":"branch"} changes</strong><p>Changes appear here as the agent works.</p></div>}</div>
    </section>
  );
}

function DiffDocument({file,index,split,folded,stage,staged,busy}:{file:DiffFile;index:number;split:boolean;folded:boolean;stage?:()=>void;staged:boolean;busy:boolean}){
 const [open,setOpen]=useState(!folded);useEffect(()=>setOpen(!folded),[folded]);
 let old=0,next=0;const rows=file.lines.filter(line=>!/^((new|deleted) file mode|similarity index|rename (from|to))/.test(line)).map(line=>{if(line.startsWith("@@")){const match=line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);old=Number(match?.[1]||0);next=Number(match?.[2]||0);return {line,hunk:true,old:"",next:"",kind:"hunk"};}const add=line.startsWith("+"),remove=line.startsWith("-");return {line,hunk:false,old:add?"":String(old++||""),next:remove?"":String(next++||""),kind:add?"addition":remove?"deletion":"context"};});
 return <article id={`diff-file-${index}`} className={`diff-document ${split?"split-diff":""}`}><header><button className="diff-fold" aria-label={`${open?"Fold":"Expand"} ${file.path}`} aria-expanded={open} onClick={()=>setOpen(v=>!v)}><CaretDown style={{transform:open?undefined:"rotate(-90deg)"}}/></button><FileCode/><strong>{file.path}</strong><span className={`file-status status-${file.status.toLowerCase()}`}>{file.status}</span>{stage&&<button disabled={busy} className="stage-file" onClick={stage}>{staged?"Unstage":"Stage"}</button>}</header>{open&&<div className="diff-lines">{rows.map((row,i)=>split&&!row.hunk?<div className={`diff-split-line ${row.kind}`} key={i}><span>{row.old}</span><code className="old-code">{row.kind==="addition"?"":row.line.slice(1)||" "}</code><span>{row.next}</span><code className="new-code">{row.kind==="deletion"?"":row.line.slice(1)||" "}</code></div>:<div className={`diff-line ${row.kind}`} key={i}><span>{row.old}</span><span>{row.next}</span><code>{row.line||" "}</code></div>)}</div>}</article>;
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
    if (!line.startsWith("index ") && !line.startsWith("--- ") && !line.startsWith("+++ ")) current.lines.push(line);
  }
  if (current) files.push(current);
  return files;
}
