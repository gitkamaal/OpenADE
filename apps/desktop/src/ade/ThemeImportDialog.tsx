import {useEffect,useMemo,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {Check,FolderOpen} from "@phosphor-icons/react";
import {compileThemeDocument,Theme} from "./themes";
import {chooseNativeThemeSource,importReviewedTheme,previewThemeSource,ThemeImportPreview,ThemeLibraryEntry,ThemeLibraryVariant} from "./theme-library-api";
import "./theme-import-dialog.css";

function sampleFor(variant:ThemeLibraryVariant):Theme|null{
 try{return compileThemeDocument(variant.document,variant.name,"import-preview",variant.appearance==="light"?"vs":"vs-dark");}catch{return null;}
}

function ThemeSample({variant,expanded}:{variant:ThemeLibraryVariant;expanded:boolean}){
 const sample=useMemo(()=>sampleFor(variant),[variant]);
 if(!sample)return null;
 return <div className={`theme-import-sample ${expanded?"expanded":""}`} aria-label={`${variant.name} color preview`}>
  <div className="theme-import-sample-shell" style={{background:sample.colors.shell,borderColor:sample.colors.border}}><span style={{background:sample.accent.primary}}/><i style={{background:sample.colors.raised}}/><i style={{background:sample.colors.raised}}/></div>
  <div className="theme-import-sample-editor" style={{background:sample.colors.background,color:sample.colors.text,borderColor:sample.colors.border}}>
   {expanded&&<><code><span style={{color:sample.syntax.keyword}}>fn </span><span style={{color:sample.syntax.function}}>preview</span><span style={{color:sample.syntax.punctuation}}>() {'{'}</span></code><code style={{color:sample.syntax.string}}>  &quot;Theme mapping&quot;</code></>}
   <div className="theme-import-sample-terminal">{sample.terminal.ansi.slice(0,8).map((color,index)=><i key={index} style={{background:color}}/>)}</div>
  </div>
 </div>;
}

export function ThemeImportDialog({onClose,onImported}:{onClose:()=>void;onImported:(entry:ThemeLibraryEntry)=>void}){
 const [path,setPath]=useState(""),[mode,setMode]=useState<"snapshot"|"link">("snapshot");
 const [preview,setPreview]=useState<ThemeImportPreview|null>(null),[selected,setSelected]=useState<string[]>([]),[details,setDetails]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const input=useRef<HTMLInputElement>(null),dialog=useRef<HTMLFormElement>(null);
 useEffect(()=>{input.current?.focus();},[]);
 const analyze=async(source=path)=>{if(!source.trim()){setError("Choose a local theme file or extension folder.");return;}setBusy(true);setError("");try{const result=await previewThemeSource(source.trim());setPath(result.path);setPreview(result);setSelected(result.variants.map(item=>item.id));setDetails(null);}catch(reason){setPreview(null);setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}};
 const pick=async(kind:"file"|"package")=>{setBusy(true);setError("");try{const source=await chooseNativeThemeSource(kind);if(source)await analyze(source);}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}};
 const install=async()=>{if(!preview||!selected.length)return;setBusy(true);setError("");try{onImported(await importReviewedTheme(preview,mode,selected));}catch(reason){const message=reason instanceof Error?reason.message:String(reason);if(message.includes("changed after analysis")){setPreview(null);setSelected([]);setDetails(null);}setError(message);}finally{setBusy(false);}};
 const changePath=(value:string)=>{setPath(value);setPreview(null);setSelected([]);setDetails(null);setError("");};
 return createPortal(<div className="theme-import-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
  <form ref={dialog} className="theme-import-dialog" role="dialog" aria-modal="true" aria-label="Import a theme" onSubmit={event=>{event.preventDefault();if(preview)void install();else void analyze();}} onKeyDown={event=>{if(event.key==="Escape"&&!busy){event.preventDefault();event.stopPropagation();onClose();}else if(event.key==="Tab"){const controls=[...(dialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)')??[])];if(!controls.length)return;const index=controls.indexOf(document.activeElement as HTMLElement);if(index<0)return;event.preventDefault();controls[(index+(event.shiftKey?-1:1)+controls.length)%controls.length]?.focus();}}}>
   <header><div><h2>Import a theme</h2><p>Review the detected palettes before adding them to OpenADE.</p></div><button type="button" className="theme-import-close" aria-label="Close theme import" onClick={onClose} disabled={busy}>×</button></header>
   <div className="theme-import-body"><label htmlFor="theme-import-path">Source</label><div className="theme-import-source"><input ref={input} id="theme-import-path" value={path} disabled={busy} onChange={event=>changePath(event.target.value)} placeholder="Local theme JSON or extension folder"/><button type="button" onClick={()=>void pick("file")} disabled={busy}><FolderOpen/>Browse file</button><button type="button" onClick={()=>void pick("package")} disabled={busy}>Browse folder</button></div>
    <div className="theme-import-section-label">Keep it up to date</div><div className="theme-import-modes" role="group" aria-label="Import mode"><button type="button" disabled={busy} aria-pressed={mode==="snapshot"} className={mode==="snapshot"?"selected":""} onClick={()=>setMode("snapshot")}><strong>Import a copy</strong><small>Works independently from the original file.</small></button><button type="button" disabled={busy} aria-pressed={mode==="link"} className={mode==="link"?"selected":""} onClick={()=>setMode("link")}><strong>Link to source</strong><small>Reload changes from the file on disk.</small></button></div>
    {preview?<><div className="theme-import-detected"><strong>Detected themes</strong><small>{preview.variants.length} variant{preview.variants.length===1?"":"s"}</small></div><div className="theme-import-variants">{preview.variants.map(variant=><div className="theme-import-variant" key={variant.id}><div className="theme-import-variant-heading"><button type="button" disabled={busy} className="theme-import-variant-select" aria-label={`Select ${variant.name}`} aria-pressed={selected.includes(variant.id)} onClick={()=>setSelected(value=>value.includes(variant.id)?value.filter(id=>id!==variant.id):[...value,variant.id])}>{selected.includes(variant.id)&&<Check/>}</button><ThemeSample variant={variant} expanded={false}/><span><strong>{variant.name}</strong><small>{variant.appearance==="light"?"Light":"Dark"}</small></span><button type="button" disabled={busy} className="theme-import-details" aria-expanded={details===variant.id} onClick={()=>setDetails(value=>value===variant.id?null:variant.id)}>{details===variant.id?"Hide details":"Details"}</button></div>{details===variant.id&&<ThemeSample variant={variant} expanded/>}</div>)}</div>{preview.failures?.map(item=><p className="theme-import-failure" key={item.id}>{item.name} could not be compiled · {item.message}</p>)}</>:<p className="theme-import-hint">OpenADE finds light and dark variants automatically.</p>}
    {error&&<p className="theme-import-error" role="alert">{error}</p>}
   </div><footer><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="theme-import-primary" disabled={busy||Boolean(preview&&!selected.length)}>{busy?"Working…":preview?"Import selected":"Analyze theme"}</button></footer>
  </form>
 </div>,document.querySelector(".ade")||document.body);
}
