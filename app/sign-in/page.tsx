import { FlaskConical, ShieldCheck } from "lucide-react";
import { signIn } from "@/auth";

export default function SignInPage() {
  const showcaseEnabled = process.env.SYNTHETIC_SHOWCASE_MODE === "true";
  return <div className="signin-layout">
    <section className="signin-story"><div className="brand-mark large"><FlaskConical size={28}/></div><p className="eyebrow">Learning Foundry</p><h1>Turn live learning evidence into governed capability.</h1><p>Learners, teachers, experts and engineers share one evidence chain—without sharing authority.</p><div className="trust-line"><ShieldCheck size={18}/> PostgreSQL Product State · LangGraph human interrupts · governed citations</div></section>
    <section className="signin-card"><p className="eyebrow">{showcaseEnabled ? "Isolated synthetic showcase" : "Authentication boundary"}</p><h2>Sign in to a workspace</h2>{showcaseEnabled ? <><form action={async (formData) => { "use server"; await signIn("credentials", { email: formData.get("email"), password: formData.get("password"), institutionSlug: formData.get("institutionSlug"), redirectTo: "/" }); }} className="stack">
      <label>Institution<input name="institutionSlug" required placeholder="Institution slug"/></label>
      <label>Email<input name="email" type="email" required autoComplete="username"/></label>
      <label>Password<input name="password" type="password" required autoComplete="current-password"/></label>
      <button type="submit">Enter Learning Foundry</button>
    </form><div className="demo-accounts"><strong>Showcase data only</strong><small>Credentials are supplied out-of-band and are accepted only while SYNTHETIC_SHOWCASE_MODE=true.</small></div></> : <div className="empty"><p>No production authentication provider is configured in Checkpoint A.</p><small>Credentials authentication is disabled unless the isolated synthetic showcase gate is enabled.</small></div>}</section>
  </div>;
}
