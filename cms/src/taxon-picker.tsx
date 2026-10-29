import { useId, useMemo, useState } from "react";
import type { Taxon, TaxonUsage } from "./api.ts";
import { entryFor, suggest } from "./taxa.ts";

interface Props {
  label: string;
  options: TaxonUsage[];
  value: Taxon[];
  max?: number;
  onChange: (next: Taxon[]) => void;
}

type Row = { key: string; taxon: Taxon; usage?: TaxonUsage };

export function TaxonPicker({ label, options, value, max, onChange }: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const full = max !== undefined && value.length >= max;
  const entry = useMemo(() => entryFor(options, query), [options, query]);
  const rows = useMemo(() => {
    const found: Row[] = suggest(options, query, value).map((o) => ({ key: o.slug, taxon: { slug: o.slug, name: o.name }, usage: o }));
    if (entry.kind === "new") found.push({ key: "new", taxon: entry.taxon });
    else if (entry.kind === "existing") {
      const exact = found.findIndex((r) => r.key === entry.taxon.slug);
      if (exact > 0) found.unshift(...found.splice(exact, 1));
    }
    return found;
  }, [options, query, value, entry]);
  const invalid = query.trim() !== "" && entry.kind === "invalid";
  const index = Math.min(active, rows.length - 1);
  const optionId = (i: number) => `${id}-opt-${i}`;

  const add = (taxon: Taxon) => {
    if (value.some((v) => v.slug === taxon.slug)) return;
    onChange([...value, taxon]);
    setQuery("");
    setActive(0);
  };
  const commitTyped = () => {
    if (query.trim() === "") return;
    if (entry.kind !== "invalid") add(entry.taxon);
  };
  const pickHighlighted = () => {
    const row = rows[index];
    if (row && open) add(row.taxon);
    else commitTyped();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (rows.length > 0) setActive((index + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickHighlighted();
    } else if (e.key === "," || e.key === "，") {
      e.preventDefault();
      commitTyped();
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && query === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const showList = open && !full && (rows.length > 0 || invalid);

  return (
    <div className="field taxon-picker">
      <span id={`${id}-label`}>{label}</span>
      <div className="taxon-box">
        {value.map((t) => (
          <span key={t.slug} className="chip">
            {t.name}
            {t.name !== t.slug && <small>{t.slug}</small>}
            <button type="button" aria-label={`移除 ${t.name}`} onClick={() => onChange(value.filter((v) => v.slug !== t.slug))}>
              ×
            </button>
          </span>
        ))}
        {!full && (
          <input
            role="combobox"
            aria-labelledby={`${id}-label`}
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={showList && rows.length > 0 ? optionId(index) : undefined}
            aria-autocomplete="list"
            aria-invalid={invalid}
            value={query}
            placeholder={value.length === 0 ? "輸入以搜尋，或 slug:名稱 新增" : ""}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          />
        )}
      </div>
      {showList && (
        <ul id={listId} role="listbox" aria-labelledby={`${id}-label`} className="taxon-list">
          {rows.map((r, i) => (
            <li
              key={r.key}
              id={optionId(i)}
              role="option"
              aria-selected={i === index}
              className={i === index ? "active" : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                add(r.taxon);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {r.usage ? (
                <>
                  <span>{r.taxon.name}</span>
                  <small>{r.taxon.slug}</small>
                  <small className="count">{r.usage.articles} 篇</small>
                </>
              ) : (
                <span>
                  {entry.kind === "existing" ? "選用「" : "新增「"}
                  {r.taxon.slug}
                  {r.taxon.name !== r.taxon.slug ? `:${r.taxon.name}` : ""}」
                </span>
              )}
            </li>
          ))}
          {invalid && <li role="presentation" className="hint-row">slug 須為小寫英數與連字號，名稱用 slug:名稱 指定</li>}
        </ul>
      )}
    </div>
  );
}
