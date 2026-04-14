import { useState } from "react";
import { useAuth } from "./AuthContext";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "./firebase";
// ─── Icons ────────────────────────────────────────────────────────────────────
const MailIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/>
  </svg>
);
const LockIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
  </svg>
);
const EyeIcon = ({ open }) => open ? (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>
) : (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/>
  </svg>
);
const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #f0f2f5;
    --card: #ffffff;
    --text: #111827;
    --muted: #6b7280;
    --border: #4d79cf;
    --border-focus: #111827;
    --input-bg: #f9fafb;
    --error: #dc2626;
    --success: #16a34a;
    --link: #2563eb;
    --font: 'DM Sans', -apple-system, sans-serif;
  }
  body { font-family: var(--font); background: var(--bg); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; }
  .card { background: var(--card); border-radius: 20px; padding: 2.25rem 2rem 2rem; width: 100%; max-width: 375px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  h1 { font-size: 26px; font-weight: 700; color: var(--text); margin-bottom: 5px; letter-spacing: -0.5px; }
  .sub { font-size: 14px; color: var(--muted); margin-bottom: 1.6rem; }
  .sub a { color: var(--link); text-decoration: none; font-weight: 500; cursor: pointer; }
  .sub a:hover { text-decoration: underline; }

  /* Inputs */
  .field { margin-bottom: 11px; }
  .wrap { display: flex; align-items: center; background: var(--input-bg); border: 1.5px solid var(--border); border-radius: 10px; transition: border-color 0.15s, background 0.15s; }
  .wrap:focus-within { border-color: var(--border-focus); background: #fff; }
  .ico { padding: 0 10px 0 13px; color: #9ca3af; display: flex; align-items: center; flex-shrink: 0; }
  .wrap input { flex: 1; border: none; background: transparent; padding: 13px 4px; font-family: var(--font); font-size: 14.5px; color: var(--text); outline: none; min-width: 0; }
  .wrap input::placeholder { color: #c0c8d4; }
  .eye { padding: 0 13px; background: none; border: none; cursor: pointer; color: #9ca3af; display: flex; align-items: center; transition: color 0.15s; }
  .eye:hover { color: var(--text); }

  /* Buttons */
  .btn { width: 100%; padding: 13.5px; background: #111827; color: #fff; border: none; border-radius: 10px; font-family: var(--font); font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.15s, transform 0.1s; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .btn:hover:not(:disabled) { background: #1f2937; }
  .btn:active:not(:disabled) { transform: scale(0.99); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }

  /* Divider */
  .div { display: flex; align-items: center; gap: 12px; margin: 1.4rem 0 1.1rem; }
  .div::before, .div::after { content: ''; flex: 1; height: 1px; background: var(--border); }
  .div span { font-size: 13px; color: var(--muted); }
  .social-lbl { text-align: center; font-size: 13.5px; color: var(--text); margin-bottom: 14px; }

  /* Social buttons */
  .socials { display: flex; justify-content: center; gap: 14px; }
  .soc { width: 52px; height: 52px; border-radius: 50%; background: #fff; border: 1.5px solid var(--border); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s; }
  .soc:hover { border-color: #9ca3af; transform: translateY(-1px); box-shadow: 0 4px 10px rgba(0,0,0,0.08); }

  /* Alerts */
  .alert { border-radius: 9px; padding: 10px 13px; font-size: 13px; margin-bottom: 12px; line-height: 1.5; }
  .alert.error { background: #fef2f2; border: 1px solid #fecaca; color: var(--error); }
  .alert.success { background: #f0fdf4; border: 1px solid #bbf7d0; color: var(--success); }

  /* Spinner */
  .spin { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff; border-radius: 50%; animation: rot 0.7s linear infinite; }
  @keyframes rot { to { transform: rotate(360deg); } }

  /* Terms */
  .terms { text-align: center; margin-top: 1.4rem; font-size: 12px; color: var(--muted); line-height: 1.65; }
  .terms a { color: var(--link); text-decoration: none; }
  .terms a:hover { text-decoration: underline; }
`;

export default function Login() {
  const [isRegister, setIsReg]  = useState(false);
  const [showPwd, setShowPwd]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [name, setName]         = useState("");
  const [message, setMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  function clear() { setError(""); setSuccess(""); }

  // ── Email auth ──────────────────────────────────────────────────────────────
  const { loginWithEmail, signupWithEmail, loginWithGoogle } = useAuth();

async function handleEmail(e) {
  e.preventDefault();
  clear();

  if (!email || !password) {
    setError("Please fill in all fields.");
    return;
  }

  if (password.length < 6) {
    setError("Password must be at least 6 characters.");
    return;
  }

  setLoading(true);

  try {
    if (isRegister) {
      await signupWithEmail(email, password, name);
    } else {
      await loginWithEmail(email, password);
    }

    // ❌ REMOVE success message (UI auto changes anyway)
  } catch (err) {
    const msgs = {
      "auth/user-not-found": "No account found with this email.",
      "auth/wrong-password": "Incorrect password.",
      "auth/email-already-in-use": "Email already exists.",
      "auth/invalid-email": "Invalid email.",
      "auth/too-many-requests": "Try again later.",
      "auth/invalid-credential": "Incorrect email or password.",
    };

    setError(msgs[err.code] || err.message);
  } finally {
    setLoading(false);
  }
}

async function handleGoogle() {
  clear();
  setLoading(true);

  try {
    await loginWithGoogle();
  } catch (err) {
    if (err.code !== "auth/popup-closed-by-user") {
      setError("Google sign-in failed.");
    }
  } finally {
    setLoading(false);
  }
}
const handleForgotPassword = async () => {
  setMessage("");
  setErrorMsg("");

  if (!email) {
    setErrorMsg("Please enter your email first");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    setMessage("Password reset email sent ✔");
  } catch (error) {
    setErrorMsg(error.message);
  }
};

  return (
    <>
      <style>{CSS}</style>

      <div className="card">
        <h1>{isRegister ? "Create account" : "Sign in"}</h1>
        <p className="sub">
          {isRegister ? "Already have an account? " : "New user? "}
          <a onClick={() => { setIsReg(r => !r); clear(); }}>
            {isRegister ? "Sign in" : "Create an account"}
          </a>
        </p>

        {error   && <div className="alert error">{error}</div>}
        {success && <div className="alert success">{success}</div>}

        <form onSubmit={handleEmail}>
          {isRegister && (
            <div className="field">
              <div className="wrap">
                <span className="ico">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                </span>
                <input type="text" placeholder="Full Name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
              </div>
            </div>
          )}

          <div className="field">
            <div className="wrap">
              <span className="ico"><MailIcon /></span>
              <input type="email" placeholder="Email Address" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
            </div>
          </div>

          <div className="field">
            <div className="wrap">
              <span className="ico"><LockIcon /></span>
              <input
                type={showPwd ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete={isRegister ? "new-password" : "current-password"}
              />
              <button type="button" className="eye" onClick={() => setShowPwd(p => !p)} tabIndex={-1}>
                <EyeIcon open={showPwd} />
              </button>
            </div>
          </div>

          {!isRegister && (
            <div style={{ textAlign: "left", marginBottom: "1.1rem" }}>
              <a href="#" style={{ fontSize: 13.5, color: "var(--link)", textDecoration: "none", fontWeight: 500 }}>
                <p
  style={{ cursor: "pointer", color: "#4f46e5", marginTop: "8px" }}
  onClick={handleForgotPassword}
>
  Forgot password?
</p>
              </a>
            </div>
          )}
  {message && (
  <div style={{
    background: "#e6f4ea",
    color: "#166534",
    padding: "10px",
    borderRadius: "8px",
    marginBottom: "10px",
    fontSize: "14px"
  }}>
    {message}
  </div>
)}

{errorMsg && (
  <div style={{
    background: "#fee2e2",
    color: "#991b1b",
    padding: "10px",
    borderRadius: "8px",
    marginBottom: "10px",
    fontSize: "14px"
  }}>
    {errorMsg}
  </div>
)}
          <button className="btn" type="submit" disabled={loading}>
            {loading ? <span className="spin" /> : isRegister ? "Create Account" : "Login"}
          </button>
        </form>

        <div className="div"><span>or</span></div>
        <p className="social-lbl">Join With Your Favorite Social Media Account</p>
        <div className="socials">
          <button className="soc" title="Continue with Google" onClick={handleGoogle} disabled={loading}>
            <GoogleIcon />
          </button>
        </div>

        <p className="terms">
          By signing in with an account, you agree to our{" "}
          <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.
        </p>
      </div>
    </>
  );
}
