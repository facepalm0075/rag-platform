const EVT = "rag-sessions-changed";
export const emitSessionsChanged = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
};
export const onSessionsChanged = (cb: () => void) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
};
