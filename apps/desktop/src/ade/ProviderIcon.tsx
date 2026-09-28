import { TerminalWindow, Robot } from "@phosphor-icons/react";
import claude from "./provider-icons/claude.svg";
import codex from "./provider-icons/openai.svg";
import grok from "./provider-icons/grok.svg";
import devin from "./provider-icons/devin-mark.svg";
import hermes from "./provider-icons/hermes-mark.svg";
import pi from "./provider-icons/pi-mark.svg";
import antigravity from "./provider-icons/antigravity-mark.svg";
import cursor from "./provider-icons/cursor-mark.svg";
export function ProviderIcon({provider}:{provider:string}) {
 const icon=({claude,codex,cursor,grok,devin,hermes,pi,antigravity,"claude-code":claude,"codex-cli":codex} as Record<string,string>)[provider];
 return icon?<img className={`provider-icon provider-${provider}`} src={icon} alt=""/>:provider==="shell"?<TerminalWindow className="provider-icon"/>:<Robot className="provider-icon"/>;
}
