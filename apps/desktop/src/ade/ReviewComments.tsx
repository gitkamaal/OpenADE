import { ChatCircleDots, PencilSimple, X } from "@phosphor-icons/react";
import { useEffect, useId, useRef } from "react";

export type CommentSide = "old" | "new";
export interface ReviewComment {
  id: string;
  path: string;
  line: number;
  body: string;
  source: "diff" | "file";
  side?: CommentSide;
  oldPath?: string;
}

export const COMMENT_BLOCK_HEADER = "Comments on the diff (each cites the file and line it belongs to; L = line number in the original file, R = in the changed file):";
export const REVIEW_COMMENT_BLOCK_HEADER = "Review comments (each cites the workspace file and line it belongs to):";
export const COMMENT_ONLY_TEXT = "Address the review comments below.";

export function commentLocation(comment: ReviewComment) {
  return `${comment.side === "old" ? comment.oldPath || comment.path : comment.path}:${comment.line}`;
}

export function withReviewComments(text: string, comments: ReviewComment[]) {
  if (!comments.length) return text;
  const header = comments.every(comment => comment.source === "diff") ? COMMENT_BLOCK_HEADER : REVIEW_COMMENT_BLOCK_HEADER;
  const bullets = comments.map(comment => `- ${commentLocation(comment)}${comment.side ? ` (${comment.side === "old" ? "L" : "R"}): ` : ": "}${comment.body.trim().replace(/\n/g, "\n  ")}`);
  return `${text || COMMENT_ONLY_TEXT}\n\n${header}\n${bullets.join("\n")}`;
}

export function parseReviewComments(text: string) {
  const markers = [COMMENT_BLOCK_HEADER, REVIEW_COMMENT_BLOCK_HEADER].map(header => `\n\n${header}\n`);
  const marker = markers.map(value => ({ value, at: text.lastIndexOf(value) })).sort((a, b) => b.at - a.at)[0];
  if (!marker || marker.at < 0) return { text, details: [] as { location: string; tag?: string; body: string }[] };
  const block = text.slice(marker.at + marker.value.length);
  if (!block || !block.split("\n").every(line => line.startsWith("- ") || line.startsWith("  "))) return { text, details: [] as { location: string; tag?: string; body: string }[] };
  const details: { location: string; tag?: string; body: string }[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("  ")) { if (details.length) details[details.length - 1].body += `\n${line.slice(2)}`; continue; }
    const bullet = line.slice(2);
    const match = bullet.match(/^(.*:\d+)(?: \(([LR])\))?: (.*)$/);
    if (!match) return { text, details: [] as { location: string; tag?: string; body: string }[] };
    details.push({ location: match[1], tag: match[2], body: match[3] });
  }
  return details.length ? { text: text.slice(0, marker.at), details } : { text, details };
}

export function ReviewCommentCard({ comment, onEdit, onRemove, hideLocation = false }: { comment: ReviewComment; onEdit: () => void; onRemove: () => void; hideLocation?: boolean }) {
  return <div className="review-comment-card"><div className="review-comment-bar"/><div><header><ChatCircleDots/>{!hideLocation&&<code>{commentLocation(comment)}{comment.side ? ` (${comment.side === "old" ? "L" : "R"})` : ""}</code>}<button aria-label={`Edit comment at ${commentLocation(comment)}`} onClick={onEdit}><PencilSimple/></button><button aria-label={`Remove comment at ${commentLocation(comment)}`} onClick={onRemove}><X/></button></header><p>{comment.body}</p></div></div>;
}

export function ReviewCommentDraft({ path, line, value, onChange, onSave, onCancel, hideLocation = false }: { path: string; line: number; value: string; onChange: (value: string) => void; onSave: () => void; onCancel: () => void; hideLocation?: boolean }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  useEffect(() => { input.current?.focus(); }, [path, line]);
  return <div className="review-comment-draft"><div className="review-comment-bar"/><div>{!hideLocation&&<label htmlFor={id}>{path}:{line}</label>}<textarea id={id} ref={input} aria-label={`Comment on ${path} line ${line}`} placeholder="Request a change…" value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSave(); } }}/><div><button onClick={onCancel}>Cancel</button><button disabled={!value.trim()} onClick={onSave}>Save comment</button></div></div></div>;
}
