import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, type Draft } from "./api.ts";
import { ArticleList } from "./article-list.tsx";
import { Editor } from "./editor.tsx";
import { isSlug } from "./taxa.ts";
import "./styles.css";

type Route = { page: "list" } | { page: "new" } | { page: "edit"; docId: string };

function parseRoute(hash: string): Route {
  const edit = /^#\/edit\/([0-9A-Z]{26})$/.exec(hash);
  if (edit) return { page: "edit", docId: edit[1]! };
  return hash === "#/new" ? { page: "new" } : { page: "list" };
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash));
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

function NewArticle() {
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState({ slug: "", name: "" });
  const [error, setError] = useState("");
  const valid = isSlug(topic.slug) && topic.name.trim() !== "";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const d = await api.create({ title, topic, tags: [], markdown: "" });
      location.replace(`#/edit/${d.doc_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <form className="new-article" onSubmit={submit}>
      <h1>新增文章</h1>
      <label className="field">
        <span>標題</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>Topic slug</span>
        <input value={topic.slug} onChange={(e) => setTopic({ ...topic, slug: e.target.value })} placeholder="backend" />
      </label>
      <label className="field">
        <span>Topic 名稱</span>
        <input value={topic.name} onChange={(e) => setTopic({ ...topic, name: e.target.value })} placeholder="Backend" />
      </label>
      {error && <p className="banner">{error}</p>}
      <button type="submit" disabled={!valid}>
        建立草稿
      </button>
      <a href="#/">取消</a>
    </form>
  );
}

function EditArticle({ docId }: { docId: string }) {
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api.draft(docId).then(setDraft, (e) => setError(String(e)));
  }, [docId]);
  useEffect(load, [load]);
  if (error) return <p className="banner">{error}</p>;
  return draft ? <Editor key={`${draft.doc_id}@${draft.revision}`} draft={draft} onReload={load} /> : <p>載入中…</p>;
}

function App() {
  const route = useRoute();
  switch (route.page) {
    case "list":
      return <ArticleList />;
    case "new":
      return <NewArticle />;
    case "edit":
      return <EditArticle docId={route.docId} />;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
