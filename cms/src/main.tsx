import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { EMPTY_METADATA, SIGNED_IN, SIGNED_OUT, api, type Draft } from "./api.ts";
import { ArticleList } from "./article-list.tsx";
import { Editor } from "./editor.tsx";
import { confirmLeave } from "./leave-guard.ts";
import { ProfilePage } from "./profile-page.tsx";
import { Releases } from "./releases.tsx";
import { SignIn } from "./sign-in.tsx";
import { TaxaPage } from "./taxa-page.tsx";
import { isSlug } from "./taxa.ts";
import "./styles.css";

type Route =
  | { page: "list" }
  | { page: "new" }
  | { page: "releases" }
  | { page: "profile" }
  | { page: "taxa" }
  | { page: "edit"; docId: string };

function parseRoute(hash: string): Route {
  const edit = /^#\/edit\/([0-9A-Z]{26})$/.exec(hash);
  if (edit) return { page: "edit", docId: edit[1]! };
  if (hash === "#/new") return { page: "new" };
  if (hash === "#/profile") return { page: "profile" };
  if (hash === "#/taxa") return { page: "taxa" };
  return hash === "#/releases" ? { page: "releases" } : { page: "list" };
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    let shown = location.hash;
    const onChange = () => {
      if (!confirmLeave()) {
        history.replaceState(null, "", shown || "#/");
        return;
      }
      shown = location.hash;
      setRoute(parseRoute(location.hash));
    };
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
      const d = await api.create({ title, topic, tags: [], markdown: "", ...EMPTY_METADATA });
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

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case "list":
      return <ArticleList />;
    case "new":
      return <NewArticle />;
    case "releases":
      return <Releases />;
    case "profile":
      return <ProfilePage />;
    case "taxa":
      return <TaxaPage />;
    case "edit":
      return <EditArticle docId={route.docId} />;
  }
}

function App() {
  const route = useRoute();
  const [signedIn, setSignedIn] = useState<boolean>();
  useEffect(() => {
    api.session().then((s) => setSignedIn(s.signed_in), () => setSignedIn(false));
    const onSignedOut = () => setSignedIn(false);
    addEventListener(SIGNED_OUT, onSignedOut);
    return () => removeEventListener(SIGNED_OUT, onSignedOut);
  }, []);
  // Keeps the page mounted under the sign-in overlay, so an editor whose
  // session expired keeps its unsaved text.
  const [everSignedIn, setEverSignedIn] = useState(false);
  if (signedIn && !everSignedIn) setEverSignedIn(true);
  if (signedIn === undefined) return <p>載入中…</p>;
  return (
    <>
      {everSignedIn && (
        <div inert={!signedIn}>
          <Page route={route} />
        </div>
      )}
      {!signedIn && (
        <SignIn
          onSignedIn={() => {
            setSignedIn(true);
            dispatchEvent(new Event(SIGNED_IN));
          }}
        />
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
