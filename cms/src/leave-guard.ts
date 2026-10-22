import { useEffect } from "react";

// The CMS routes by hash, which never fires beforeunload, so the router asks
// confirmLeave() before following a hash change.
let question: string | undefined;

/** Warns before the tab closes while `unsaved`, and before another CMS page opens while `ask` is set. */
export function useLeaveGuard(unsaved: boolean, ask?: string): void {
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [unsaved]);
  useEffect(() => {
    if (!ask) return;
    question = ask;
    return () => {
      if (question === ask) question = undefined;
    };
  }, [ask]);
}

export const confirmLeave = (): boolean => question === undefined || window.confirm(question);
