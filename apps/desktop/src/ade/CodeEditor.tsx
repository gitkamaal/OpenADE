import {HighlightStyle,syntaxHighlighting} from "@codemirror/language";
import {tags} from "@lezer/highlight";
import {useEffect,useRef} from "react";
import {basicSetup} from "codemirror";
import {EditorView} from "@codemirror/view";
import {EditorState,Compartment} from "@codemirror/state";
import {javascript} from "@codemirror/lang-javascript";
import {json} from "@codemirror/lang-json";
import {markdown} from "@codemirror/lang-markdown";
import {python} from "@codemirror/lang-python";
import {html} from "@codemirror/lang-html";
import {css} from "@codemirror/lang-css";
function language(path:string){const ext=path.split('.').at(-1);if(['js','jsx','ts','tsx'].includes(ext||''))return javascript({typescript:ext==='ts'||ext==='tsx',jsx:ext==='jsx'||ext==='tsx'});if(ext==='json')return json();if(ext==='md')return markdown();if(ext==='py')return python();if(['html','htm'].includes(ext||''))return html();if(ext==='css')return css();return [];}
export default function CodeEditor({path,value,onChange,wrap,disabled}:{path:string;value:string;onChange:(value:string)=>void;wrap:boolean;disabled:boolean}){
 const host=useRef<HTMLDivElement>(null);const view=useRef<EditorView|null>(null);const callback=useRef(onChange);callback.current=onChange;const config=useRef(new Compartment());
 useEffect(()=>{if(!host.current)return;const editor=new EditorView({parent:host.current,state:EditorState.create({doc:value,extensions:[basicSetup,syntaxHighlighting(HighlightStyle.define([{tag:tags.keyword,color:"var(--syntax-keyword)"},{tag:[tags.string,tags.regexp],color:"var(--syntax-string)"},{tag:[tags.number,tags.bool,tags.null],color:"var(--syntax-number)"},{tag:[tags.typeName,tags.className],color:"var(--syntax-type)"},{tag:[tags.variableName,tags.propertyName],color:"var(--text)"},{tag:tags.comment,color:"var(--muted-2)",fontStyle:"italic"},{tag:tags.function(tags.variableName),color:"var(--syntax-function)"}])),language(path),config.current.of([EditorView.editable.of(!disabled),...(wrap?[EditorView.lineWrapping]:[])]),EditorView.contentAttributes.of({'aria-label':`Edit ${path}`,'role':'textbox','aria-multiline':'true'}),EditorView.updateListener.of(update=>{if(update.docChanged)callback.current(update.state.doc.toString());}),EditorView.theme({'&':{height:'100%',fontSize:'var(--code-size)',color:'var(--text)',backgroundColor:'transparent'},'.cm-scroller':{fontFamily:'var(--code-font)',overflow:'auto'},'.cm-gutters':{backgroundColor:'transparent',color:'var(--faint)',borderRight:'1px solid var(--line)'},'.cm-activeLine,.cm-activeLineGutter':{backgroundColor:'color-mix(in srgb,var(--accent) 6%,transparent)'},'.cm-cursor':{borderLeftColor:'var(--text)'},'.cm-selectionBackground':{backgroundColor:'color-mix(in srgb,var(--accent) 25%,transparent) !important'},'.cm-content':{padding:'8px 0'}})]})});view.current=editor;return()=>{editor.destroy();view.current=null;};},[path]);
 useEffect(()=>{const editor=view.current;if(editor&&editor.state.doc.toString()!==value)editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:value}});},[value]);
 useEffect(()=>{view.current?.dispatch({effects:config.current.reconfigure([EditorView.editable.of(!disabled),...(wrap?[EditorView.lineWrapping]:[])])});},[wrap,disabled]);
 return <div className="code-editor-host" ref={host}/>;
}
