// Text inputs often match :focus-visible even after a pointer click in WebKit.
// Track the last navigation method so custom popovers and composer fields can
// keep a keyboard focus indicator without flashing one on pointer activation.
const root = document.documentElement;
// Until a real pointer event occurs, keep focus visible for accessibility
// actions that move focus without dispatching a key event.
root.dataset.inputModality = "keyboard";

document.addEventListener("pointerdown", () => {
  root.dataset.inputModality = "pointer";
}, true);

document.addEventListener("keydown", event => {
  const target = event.target;
  const editable = target instanceof HTMLElement && (target.isContentEditable || target.matches("input,textarea,[role='textbox']"));
  const navigation = ["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Enter", " "].includes(event.key);
  if (event.key === "Tab" || (navigation && !editable) || event.metaKey || event.ctrlKey || event.altKey) {
    root.dataset.inputModality = "keyboard";
  }
}, true);
