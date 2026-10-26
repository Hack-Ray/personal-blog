"use client";

import { type MouseEvent, useEffect, useState } from "react";
import { shareLinks } from "../../../content/share.ts";

const COPIED_MS = 2000;

// Brand marks from Simple Icons (CC0), drawn in currentColor on a 24×24 grid.
const ICONS: Record<string, string> = {
  Facebook:
    "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
  X: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  Threads:
    "M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z",
  LINE: "M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314",
};

type Copy = "idle" | "copied" | "failed";
const COPY_LABEL: Record<Copy, string> = { idle: "複製連結", copied: "已複製", failed: "複製失敗" };

/** Phones get the system share sheet; a desktop's own share menu is easy to miss, so it keeps copy. */
type Extra = "sheet" | "copy" | "none";

const pickExtra = (): Extra =>
  "share" in navigator && matchMedia("(pointer: coarse)").matches ? "sheet" : navigator.clipboard ? "copy" : "none";

export function Share({ url, title }: { url: string; title: string }) {
  const [extra, setExtra] = useState<Extra>("none");
  const [copy, setCopy] = useState<Copy>("idle");

  useEffect(() => setExtra(pickExtra()), []);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
    setTimeout(() => setCopy("idle"), COPIED_MS);
  };

  // On phones the Facebook app claims facebook.com links and drops the sharer's URL,
  // so the Facebook button opens the share sheet there too.
  const onFacebook = (e: MouseEvent<HTMLAnchorElement>) => {
    if (extra !== "sheet") return;
    e.preventDefault();
    const sharer = e.currentTarget.href;
    navigator.share({ url, title }).catch((err) => {
      if (err.name !== "AbortError") open(sharer, "_blank", "noopener");
    });
  };

  return (
    <section className="share" aria-label="分享這篇文章">
      <span className="meta">分享</span>
      {shareLinks(url, title).map((l) => (
        <a
          key={l.name}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`分享到 ${l.name}`}
          title={l.name}
          onClick={l.name === "Facebook" ? onFacebook : undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={ICONS[l.name]} />
          </svg>
        </a>
      ))}
      {extra === "sheet" && (
        <button
          type="button"
          onClick={() => navigator.share({ url, title }).catch(() => {})}
          aria-label="更多分享方式"
          title="更多分享方式"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <path d="m16 6-4-4-4 4" />
            <path d="M12 2v13" />
          </svg>
        </button>
      )}
      {extra === "copy" && (
        <button type="button" onClick={onCopy} aria-label={COPY_LABEL[copy]} title={COPY_LABEL[copy]}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
            {copy === "copied" ? (
              <path d="M20 6 9 17l-5-5" />
            ) : (
              <>
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </>
            )}
          </svg>
        </button>
      )}
      <span className="share-status" aria-live="polite">
        {copy === "idle" ? "" : COPY_LABEL[copy]}
      </span>
    </section>
  );
}
