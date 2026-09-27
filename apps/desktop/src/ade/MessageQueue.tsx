import {
  ArrowBendDownRight,
  ArrowBendUpLeft,
  DotsThree,
  Trash,
} from "@phosphor-icons/react";
import { QueuedMessage } from "./api";

export function MessageQueue({
  steering=false,
  messages,
  sendingId,
  onSteer,
  onRemove,
  onEdit,
}: {
  steering?:boolean;
  messages: QueuedMessage[];
  sendingId: string | null;
  onSteer: (id: string) => void;
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  if (messages.length === 0) return null;
 const uncertain=messages.filter(message=>message.status==="uncertain").length;

  return (
    <section className="message-queue" aria-label="Queued messages">
      <span className="queue-progress">{uncertain?`${uncertain} unconfirmed · review before resending`:`${messages.length} queued · sends after this turn`}</span>
      <div className="queue-list">
        {messages.map((message, index) => (
          <article className={`queue-item ${message.status} ${sendingId === message.id ? "sending" : ""}`} key={message.id}>
            <span className="queue-order" aria-hidden="true"><ArrowBendDownRight /></span>
            <span className="queue-index">{index + 1}</span>
            <p title={message.text}>{message.text}</p>
            <button type="button" className="queue-steer" onClick={() => onSteer(message.id)} disabled={message.status!=="queued"} title={steering?"Send into the current turn":"Move this message to the front of the queue"}>
              <ArrowBendUpLeft /> <span>{message.status==="uncertain"?"Unconfirmed":sendingId === message.id || message.status==="steering" || message.status==="provider-starting" ? "Sending" : steering?"Send now":"Send next"}</span>
            </button>
            <button type="button" className="queue-action" onClick={() => onRemove(message.id)} disabled={message.status!=="queued"&&message.status!=="uncertain"} aria-label={`Remove queued message ${index + 1}`} title="Remove from queue"><Trash /></button>
            <button type="button" className="queue-action" onClick={() => onEdit(message.id)} disabled={message.status!=="queued"} aria-label={`Edit queued message ${index + 1}`} title="Edit message"><DotsThree /></button>
          </article>
        ))}
      </div>
    </section>
  );
}
