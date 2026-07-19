import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Factory, FlaskConical, GraduationCap, LogOut, Microscope } from "lucide-react";
import { auth, signOut } from "@/auth";
import { getActorFromSessionUser } from "@/application/identity";
import "./globals.css";

export const metadata: Metadata = {
  title: "Learning Foundry",
  description: "Evidence-grounded learning and governed capability production.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  const actor = session?.user?.id ? await getActorFromSessionUser(session.user).catch(() => null) : null;
  const links = actor ? [
    actor.roles.some((role) => role === "LEARNER" || role === "ADMIN") ? { href: "/learner", label: "Learner", icon: GraduationCap } : null,
    actor.roles.some((role) => role === "TEACHER" || role === "ADMIN") ? { href: "/teacher", label: "Teacher", icon: BookOpen } : null,
    actor.roles.some((role) => role === "EXPERT" || role === "ADMIN") ? { href: "/foundry", label: "Foundry", icon: Factory } : null,
    actor.roles.some((role) => role === "ENGINEER" || role === "ADMIN") ? { href: "/engineering", label: "Engineering", icon: Microscope } : null,
  ].filter(Boolean) as Array<{ href: string; label: string; icon: typeof GraduationCap }> : [];
  return <html lang="en"><body>
    <div className="ambient ambient-one"/><div className="ambient ambient-two"/>
    {actor ? <header className="app-nav">
      <Link className="brand" href="/"><span className="brand-mark"><FlaskConical size={18}/></span><span>Learning Foundry<small>Evidence → capability</small></span></Link>
      <nav>{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href}><Icon size={16}/>{label}</Link>)}</nav>
      <div className="identity"><span>{session?.user?.name}<small>{actor.roles.join(" · ")}</small></span><form action={async () => { "use server"; await signOut({ redirectTo: "/sign-in" }); }}><button className="icon-button" aria-label="Sign out"><LogOut size={17}/></button></form></div>
    </header> : null}
    <main className={actor ? "app-main" : "public-main"}>{children}</main>
  </body></html>;
}
