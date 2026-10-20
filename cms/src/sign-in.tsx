import { useState } from "react";
import { ApiError, api } from "./api.ts";

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.signIn(password);
      setPassword("");
      onSignedIn();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "密碼錯誤。"
          : err instanceof ApiError && err.status === 429
            ? "失敗次數過多，請 15 分鐘後再試。"
            : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay">
      <form className="sign-in" onSubmit={submit} aria-label="登入">
        <h1>登入 CMS</h1>
        <label className="field">
          <span>管理員密碼</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        {error && <p className="banner">{error}</p>}
        <button type="submit" disabled={busy || password === ""}>
          登入
        </button>
      </form>
    </div>
  );
}
