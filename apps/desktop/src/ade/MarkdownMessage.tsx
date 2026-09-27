import {SyntaxText} from "./SyntaxText";
import {WebLinkContext} from "./WebLinkContext";
import { copyText } from "./clipboard";
import { Check, Copy } from "@phosphor-icons/react";
import { isValidElement, ReactNode, useContext, useEffect, useRef, useState } from "react";
import ReactMarkdown, {defaultUrlTransform} from "react-markdown";
import {AttachmentImage} from "./Attachments";
import {fileMediaURL,Session} from "./api";
import remarkGfm from "remark-gfm";

export function MarkdownMessage({ children,session,filePath="" }: { children: string;session?:Session;filePath?:string }) {
  const openWebLink=useContext(WebLinkContext);
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url,key)=>key==="src"?url:defaultUrlTransform(url)}
        components={{
          img: ({src,alt}) => {const url=typeof src==="string"?imageURL(src,session,filePath):null;return url?<AttachmentImage image={{id:src as string,name:alt||"Image",path:src as string,mime:"image/*",size:0}} sourceURL={url} className="markdown-image"/>:<span className="image-unavailable">Image unavailable: {alt||"unsupported path"}</span>;},
          a: ({ children: label, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer" onClick={event=>{if(!openWebLink||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||!props.href)return;try{const url=new URL(props.href);if(!["http:","https:"].includes(url.protocol)||url.username||url.password)return;event.preventDefault();openWebLink(url.href);}catch{}}}>
              {label}
            </a>
          ),
          pre: ({ children: code }) => <CodeBlock>{code}</CodeBlock>,
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
