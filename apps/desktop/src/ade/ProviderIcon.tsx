import { TerminalWindow, Robot } from "@phosphor-icons/react";
import claude from "./provider-icons/claude.svg";
import codex from "./provider-icons/openai.svg";
import grok from "./provider-icons/grok.svg";
export function ProviderIcon({provider}:{provider:string}) {
 const icon=({claude,codex,grok,"claude-code":claude,"codex-cli":codex} as Record<string,string>)[provider];
 return icon?<img className={`provider-icon provider-${provider}`} src={icon} alt=""/>:provider==="shell"?<TerminalWindow className="provider-icon"/>:<Robot className="provider-icon"/>;
}
