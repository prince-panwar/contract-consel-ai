import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { decryptSession, sessionCookie } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export const metadata = {
  title: "Sign in — ContractCounsel",
};

export default async function LoginPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookie.name)?.value;
  const session = await decryptSession(token);
  if (session) redirect("/");

  return (
    <main className="relative z-10 min-h-screen flex flex-col">
      <header className="px-8 py-6 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <span className="font-serif text-2xl tracking-tight text-foreground">
            ContractCounsel
          </span>
          <span className="text-accent text-2xl leading-none">.</span>
        </div>
      </header>
      <section className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <h1 className="font-serif text-3xl text-foreground leading-tight">
            Admin sign-in
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            Restricted access. Use your admin credentials.
          </p>
          <div className="mt-8">
            <LoginForm />
          </div>
        </div>
      </section>
    </main>
  );
}
