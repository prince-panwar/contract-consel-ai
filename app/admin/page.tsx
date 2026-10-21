import { AppShell } from "@/components/AppShell";
import { AdminPanel } from "@/components/AdminPanel";

export const metadata = {
  title: "Admin — ContractConsel",
};

export default function AdminPage() {
  return (
    <AppShell>
      <main className="flex-1 overflow-y-auto">
        <AdminPanel />
      </main>
    </AppShell>
  );
}
