import {SyntaxText} from "./SyntaxText";
import {WebLinkContext} from "./WebLinkContext";
import { copyText } from "./clipboard";
import { Check, Copy, Plus } from "@phosphor-icons/react";
import { Dispatch, isValidElement, ReactNode, SetStateAction, useContext, useEffect, useRef, useState } from "react";
import { ReviewComment, ReviewCommentCard, ReviewCommentDraft } from "./ReviewComments";
import ReactMarkdown, {defaultUrlTransform} from "react-markdown";
import {AttachmentImage} from "./Attachments";
import {fileMediaURL,Session} from "./api";
import remarkGfm from "remark-gfm";

export function MarkdownMessage({ children,session,filePath="",reviewComments=[],onReviewComments }: { children: string;session?:Session;filePath?:string;reviewComments?:ReviewComment[];onReviewComments?:Dispatch<SetStateAction<ReviewComment[]>> }) {
  const openWebLink=useContext(WebLinkContext);
  const [draft,setDraft]=useState<{line:number;value:string;editing?:string}|null>(null);
  const saveComment=()=>{if(!draft?.value.trim()||!onReviewComments)return;const body=draft.value.trim();onReviewComments(current=>draft.editing?current.map(comment=>comment.id===draft.editing?{...comment,body}:comment):[...current,{id:crypto.randomUUID(),path:filePath,line:draft.line,body,source:"file"}]);setDraft(null);};
  const renderBlock=(node:{position?:{start?:{line?:number}}}|undefined,content:ReactNode)=>{
    const line=node?.position?.start?.line;
    if(!filePath||!onReviewComments||!line)return content;
    const attached=reviewComments.filter(comment=>comment.source==="file"&&comment.path===filePath&&comment.line===line);
    return <div className="markdown-review-block"><button type="button" aria-label={`Add comment to Markdown line ${line} of ${filePath}`} onClick={()=>setDraft({line,value:""})}><Plus/></button>{content}{attached.filter(comment=>comment.id!==draft?.editing).map(comment=><ReviewCommentCard key={comment.id} comment={comment} onEdit={()=>setDraft({line,value:comment.body,editing:comment.id})} onRemove={()=>onReviewComments(current=>current.filter(item=>item.id!==comment.id))}/>)}{draft?.line===line&&<ReviewCommentDraft path={filePath} line={line} value={draft.value} onChange={value=>setDraft(current=>current?{...current,value}:null)} onSave={saveComment} onCancel={()=>setDraft(null)}/>}</div>;
  };
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url,key)=>key==="src"?url:defaultUrlTransform(url)}
        components={{
          p: ({node,children:body}) => renderBlock(node,<p>{body}</p>),
          h1: ({node,children:body}) => renderBlock(node,<h1>{body}</h1>),
          h2: ({node,children:body}) => renderBlock(node,<h2>{body}</h2>),
          h3: ({node,children:body}) => renderBlock(node,<h3>{body}</h3>),
          h4: ({node,children:body}) => renderBlock(node,<h4>{body}</h4>),
          h5: ({node,children:body}) => renderBlock(node,<h5>{body}</h5>),
          h6: ({node,children:body}) => renderBlock(node,<h6>{body}</h6>),
          img: ({src,alt}) => {const url=typeof src==="string"?imageURL(src,session,filePath):null;return url?<AttachmentImage image={{id:src as string,name:alt||"Image",path:src as string,mime:"image/*",size:0}} sourceURL={url} className="markdown-image"/>:<span className="image-unavailable">Image unavailable: {alt||"unsupported path"}</span>;},
          a: ({ children: label, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer" onClick={event=>{if(!openWebLink||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||!props.href)return;try{const url=new URL(props.href);if(!["http:","https:"].includes(url.protocol)||url.username||url.password)return;event.preventDefault();openWebLink(url.href);}catch{}}}>
              {label}
            </a>
          ),
          pre: ({ node,children: code }) => renderBlock(node,<CodeBlock>{code}</CodeBlock>),
          table: ({ children: table }) => (
            <div className="markdown-table-wrap"><table>{table}</table></div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
 const [copyFailed,setCopyFailed]=useState(false);
  const copyTimerRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(false);
  const text = textContent(children).replace(/\n$/, "");
  const className = isValidElement<{ className?: string }>(children)
    ? children.props.className ?? ""
    : "";
  const language = className.match(/language-([\w-]+)/)?.[1] ?? "code";
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copyTimerRef.current !== undefined) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const copy = async () => {
    try{await copyText(text);}catch{if(mountedRef.current)setCopyFailed(true);return;}
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
    <div className="markdown-code-block">
      <div className="markdown-code-head">
        <span>{language}</span>
        <button type="button" onClick={() => void copy()} aria-label="Copy code">
          {copied ? <Check /> : <Copy />}{copyFailed?"Unable to copy":copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre><code className={className}><SyntaxText text={text} language={language}/></code></pre>
    </div>
  );
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textContent(node.props.children);
  return "";
}

function imageURL(source:string,session?:Session,filePath=""):string|null {
 if(/^https?:\/\//i.test(source)){try{const url=new URL(source);return url.username||url.password?null:url.href;}catch{return null;}}
 if(!session)return null;
 let value:string;try{value=decodeURIComponent(source.replace(/^file:\/\//i,""));}catch{return null;}
 if(value.startsWith("/")){const root=session.worktree_path.replace(/\/$/,"");if(!value.startsWith(root+"/"))return null;value=value.slice(root.length+1);}
 else if(/^[a-z][a-z0-9+.-]*:/i.test(value))return null;
 else value=(filePath.includes("/")?filePath.slice(0,filePath.lastIndexOf("/")+1):"")+value;
 const parts:string[]=[];for(const part of value.split("/")){if(part==="..") {if(!parts.length)return null;parts.pop();}else if(part&&part!==".")parts.push(part);}
 if(!parts.length||parts.includes(".git"))return null;return fileMediaURL(session.id,parts.join("/"));
}
