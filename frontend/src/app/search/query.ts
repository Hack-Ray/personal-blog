const CHANGE_EVENT = "search-query-change";

export const readQuery = (): string => new URLSearchParams(location.search).get("q") ?? "";

export const writeQuery = (q: string): void => {
  history.replaceState(null, "", q ? `?q=${encodeURIComponent(q)}` : location.pathname);
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

export const onQueryChange = (listener: () => void): (() => void) => {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("popstate", listener);
  };
};
