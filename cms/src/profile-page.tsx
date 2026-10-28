import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api, type SavedProfile } from "./api.ts";
import { useLeaveGuard } from "./leave-guard.ts";
import { renderPreview, scrollToAnchor } from "./preview.ts";
import { EMPTY_ROW, describeError, fromForm, move, sameForm, toForm, validate, type ProfileForm } from "./profile-form.ts";

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "conflict" } | { kind: "error"; message: string };
type ListKey = "links" | "experience" | "projects";

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactElement }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

function Rows<K extends ListKey>({
  title,
  list,
  form,
  setForm,
  render,
}: {
  title: string;
  list: K;
  form: ProfileForm;
  setForm: (f: ProfileForm) => void;
  render: (row: ProfileForm[K][number], i: number, set: (row: ProfileForm[K][number]) => void) => React.ReactNode;
}) {
  const rows = form[list] as ProfileForm[K][number][];
  const put = (next: typeof rows) => setForm({ ...form, [list]: next });
  return (
    <fieldset className="rows">
      <legend>{title}</legend>
      {rows.map((row, i) => (
        <div className="row" key={i}>
          <div className="row-fields">{render(row, i, (r) => put(rows.map((x, j) => (j === i ? r : x))))}</div>
          <div className="row-actions">
            <button type="button" aria-label="上移" disabled={i === 0} onClick={() => put(move(rows, i, i - 1))}>
              ↑
            </button>
            <button type="button" aria-label="下移" disabled={i === rows.length - 1} onClick={() => put(move(rows, i, i + 1))}>
              ↓
            </button>
            <button type="button" onClick={() => put(rows.filter((_, j) => j !== i))}>
              移除
            </button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => put([...rows, { ...EMPTY_ROW[list] }] as typeof rows)}>
        新增
      </button>
    </fieldset>
  );
}

export function ProfilePage() {
  const [saved, setSaved] = useState<SavedProfile>();
  const [form, setForm] = useState<ProfileForm>();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [loadError, setLoadError] = useState("");

  const load = useCallback(() => {
    setStatus({ kind: "idle" });
    api.profile().then(
      (p) => {
        setSaved(p);
        setForm(toForm(p.content));
      },
      (e) => setLoadError(String(e)),
    );
  }, []);
  useEffect(load, [load]);

  const dirty = saved !== undefined && form !== undefined && !sameForm(form, toForm(saved.content));
  useLeaveGuard(dirty, dirty ? "「網站與關於」還有未儲存的修改，離開會捨棄它們。確定要離開嗎？" : undefined);

  const preview = useMemo(() => renderPreview(form?.intro ?? ""), [form?.intro]);

  if (loadError) return <p className="banner">{loadError}</p>;
  if (!saved || !form) return <p>載入中…</p>;

  const errors = validate(form);
  const invalid = Object.keys(errors).length > 0;

  const save = async () => {
    setStatus({ kind: "saving" });
    try {
      const next = await api.saveProfile(saved.revision, fromForm(form));
      setSaved(next);
      setForm(toForm(next.content));
      setStatus({ kind: "idle" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setStatus({ kind: "conflict" });
      else if (e instanceof ApiError) setStatus({ kind: "error", message: describeError(e.status, e.body.detail, e.message) });
      else setStatus({ kind: "error", message: String(e) });
    }
  };

  const label =
    status.kind === "saving"
      ? { kind: "saving", text: "儲存中…" }
      : status.kind === "conflict"
        ? { kind: "conflict", text: "網站與關於已在其他地方被修改" }
        : status.kind === "error"
          ? { kind: "error", text: `儲存失敗：${status.message}` }
          : dirty
            ? { kind: invalid ? "unsaved" : "dirty", text: invalid ? "尚未儲存：有欄位不合法" : "尚未儲存" }
            : { kind: "saved", text: "已儲存" };

  const text = (key: keyof Pick<ProfileForm, "name" | "headline">) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
  });

  const site = (key: keyof ProfileForm["site"]) => ({
    value: form.site[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, site: { ...form.site, [key]: e.target.value } }),
  });

  return (
    <div className="profile-page">
      <div className="toolbar">
        <a href="#/">← 文章列表</a>
        <h1>網站與關於</h1>
        <span className={`status status-${label.kind}`} role="status">
          {label.text}
        </span>
        <button type="button" onClick={save} disabled={!dirty || invalid || status.kind === "saving" || status.kind === "conflict"}>
          儲存
        </button>
      </div>
      <p className="hint">儲存後要到「網站發布 → 更新網站」才會出現在網站上。</p>
      {status.kind === "conflict" && (
        <p className="banner">
          網站與關於已在其他地方被修改，這裡的修改無法儲存。重新載入會捨棄這裡的修改。
          <button type="button" onClick={load}>
            重新載入
          </button>
        </p>
      )}
      <fieldset className="profile-fields site-fields">
        <legend>網站</legend>
        <Field label="網站名稱" error={errors["site.title"]}>
          <input {...site("title")} maxLength={100} aria-invalid={"site.title" in errors} />
        </Field>
        <Field label="網站簡介（可留空）">
          <input {...site("description")} maxLength={300} />
        </Field>
        <Field label="頁尾文字（留空顯示「© 年份 名字」）">
          <input {...site("footer")} maxLength={200} />
        </Field>
      </fieldset>
      <h2>關於頁</h2>
      <div className="profile-fields">
        <Field label="名字" error={errors.name}>
          <input {...text("name")} aria-invalid={"name" in errors} />
        </Field>
        <Field label="標語">
          <input {...text("headline")} />
        </Field>
      </div>
      <div className="split profile-intro">
        <textarea
          aria-label="自我介紹（Markdown）"
          placeholder="自我介紹（Markdown）"
          value={form.intro}
          onChange={(e) => setForm({ ...form, intro: e.target.value })}
          aria-invalid={"intro" in errors}
          spellCheck={false}
        />
        <div className="preview article-body" onClick={scrollToAnchor} dangerouslySetInnerHTML={{ __html: preview }} />
      </div>
      {errors.intro && <p className="hint">{errors.intro}</p>}
      <Rows
        title="連結（也顯示在頁尾）"
        list="links"
        form={form}
        setForm={setForm}
        render={(l, i, set) => (
          <>
            <Field label="名稱" error={errors[`links.${i}.label`]}>
              <input value={l.label} aria-invalid={`links.${i}.label` in errors} onChange={(e) => set({ ...l, label: e.target.value })} />
            </Field>
            <Field label="網址" error={errors[`links.${i}.url`]}>
              <input
                value={l.url}
                placeholder="https://… 或 mailto:…"
                aria-invalid={`links.${i}.url` in errors}
                onChange={(e) => set({ ...l, url: e.target.value })}
              />
            </Field>
          </>
        )}
      />
      <Rows
        title="經歷"
        list="experience"
        form={form}
        setForm={setForm}
        render={(x, i, set) => (
          <>
            <Field label="職稱" error={errors[`experience.${i}.role`]}>
              <input value={x.role} aria-invalid={`experience.${i}.role` in errors} onChange={(e) => set({ ...x, role: e.target.value })} />
            </Field>
            <Field label="組織">
              <input value={x.organization} onChange={(e) => set({ ...x, organization: e.target.value })} />
            </Field>
            <Field label="期間">
              <input value={x.period} placeholder="2023 年至今" onChange={(e) => set({ ...x, period: e.target.value })} />
            </Field>
            <Field label="說明">
              <textarea value={x.description} rows={2} onChange={(e) => set({ ...x, description: e.target.value })} />
            </Field>
          </>
        )}
      />
      <Rows
        title="作品"
        list="projects"
        form={form}
        setForm={setForm}
        render={(p, i, set) => (
          <>
            <Field label="名稱" error={errors[`projects.${i}.name`]}>
              <input value={p.name} aria-invalid={`projects.${i}.name` in errors} onChange={(e) => set({ ...p, name: e.target.value })} />
            </Field>
            <Field label="網址（可留空）" error={errors[`projects.${i}.url`]}>
              <input
                value={p.url}
                placeholder="https://…"
                aria-invalid={`projects.${i}.url` in errors}
                onChange={(e) => set({ ...p, url: e.target.value })}
              />
            </Field>
            <Field label="Tags（逗號分隔）">
              <input value={p.tags} onChange={(e) => set({ ...p, tags: e.target.value })} />
            </Field>
            <Field label="說明">
              <textarea value={p.description} rows={2} onChange={(e) => set({ ...p, description: e.target.value })} />
            </Field>
          </>
        )}
      />
    </div>
  );
}
