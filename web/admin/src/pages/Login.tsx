import { useState, FormEvent } from "react";
import { C, fonts, sz, alpha } from "../tokens";
import { clearApiKey, loginWithPassword, setApiKey, verifyAuth } from "../api";

interface LoginProps {
  onLogin: () => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [mode, setMode] = useState<"account" | "key">("account");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === "account" && (!email.trim() || !password)) return;
    if (mode === "key" && !key.trim()) return;

    setLoading(true);
    setError("");

    try {
      if (mode === "account") {
        await loginWithPassword(email.trim(), password);
        onLogin();
      } else {
        setApiKey(key.trim());
        const res = await verifyAuth();
        if (res.valid) {
          onLogin();
        } else {
          setError("Invalid API key");
          clearApiKey();
        }
      }
    } catch {
      setError(mode === "account" ? "Invalid email, password, or server unreachable" : "Invalid API key or server unreachable");
      clearApiKey();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: C.bg,
      }}
    >
      <div
        style={{
          width: 380,
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: 32,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              fontFamily: fonts.mono,
              fontSize: sz.xl,
              fontWeight: 600,
              color: C.accent,
              letterSpacing: 0.5,
              marginBottom: 4,
            }}
          >
            authplane
          </div>
          <div style={{ fontFamily: fonts.mono, fontSize: sz.sm, color: C.textDim }}>
            admin console
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <button type="button" onClick={() => { setMode("account"); setError(""); }} style={{ flex: 1, padding: "8px 10px", background: mode === "account" ? alpha(C.accent, 0x20) : "transparent", color: mode === "account" ? C.accent : C.textDim, border: `1px solid ${mode === "account" ? alpha(C.accent, 0x50) : C.border}`, borderRadius: 6, cursor: "pointer", fontFamily: fonts.mono }}>
            Account Login
          </button>
          <button type="button" onClick={() => { setMode("key"); setError(""); }} style={{ flex: 1, padding: "8px 10px", background: mode === "key" ? alpha(C.accent, 0x20) : "transparent", color: mode === "key" ? C.accent : C.textDim, border: `1px solid ${mode === "key" ? alpha(C.accent, 0x50) : C.border}`, borderRadius: 6, cursor: "pointer", fontFamily: fonts.mono }}>
            Use API Key
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === "account" ? (
            <>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: sz.xs, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 1.2, color: C.textDim, marginBottom: 6 }}>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" autoFocus style={{ width: "100%", padding: "10px 14px", background: C.surface2, border: `1px solid ${error ? C.danger : C.border2}`, borderRadius: 6, color: C.text, fontSize: sz.base, fontFamily: fonts.mono, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: sz.xs, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 1.2, color: C.textDim, marginBottom: 6 }}>Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" style={{ width: "100%", padding: "10px 14px", background: C.surface2, border: `1px solid ${error ? C.danger : C.border2}`, borderRadius: 6, color: C.text, fontSize: sz.base, fontFamily: fonts.mono, outline: "none", boxSizing: "border-box" }} />
              </div>
            </>
          ) : (
          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                display: "block",
                fontSize: sz.xs,
                fontFamily: fonts.mono,
                textTransform: "uppercase",
                letterSpacing: 1.2,
                color: C.textDim,
                marginBottom: 6,
              }}
            >
              API Key
            </label>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Enter admin API key"
              autoFocus
              style={{
                width: "100%",
                padding: "10px 14px",
                background: C.surface2,
                border: `1px solid ${error ? C.danger : C.border2}`,
                borderRadius: 6,
                color: C.text,
                fontSize: sz.base,
                fontFamily: fonts.mono,
                outline: "none",
                boxSizing: "border-box",
                transition: "border-color 0.15s",
              }}
            />
          </div>
          )}

          {error && (
            <div
              style={{
                fontSize: sz.base,
                color: C.danger,
                fontFamily: fonts.mono,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (mode === "account" ? !email.trim() || !password : !key.trim())}
            style={{
              width: "100%",
              padding: "10px 16px",
              fontSize: sz.base,
              fontFamily: fonts.mono,
              fontWeight: 500,
              background: alpha(C.accent, 0x20),
              color: C.accent,
              border: `1px solid ${alpha(C.accent, 0x50)}`,
              borderRadius: 6,
              cursor: loading || (mode === "account" ? !email.trim() || !password : !key.trim()) ? "not-allowed" : "pointer",
              opacity: loading || (mode === "account" ? !email.trim() || !password : !key.trim()) ? 0.5 : 1,
              transition: "all 0.15s",
              letterSpacing: 0.3,
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div
          style={{
            marginTop: 20,
            fontSize: sz.sm,
            color: C.textDim,
            textAlign: "center",
            fontFamily: fonts.mono,
            lineHeight: 1.6,
          }}
        >
          {mode === "account" ? "Sign in with an administrator account." : "Use the API key from your server configuration."}
        </div>
      </div>
    </div>
  );
}
