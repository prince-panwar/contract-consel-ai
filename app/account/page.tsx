import { AppShell } from "@/components/AppShell";
import { AccountSettings } from "@/components/AccountSettings";

export const metadata = {
  title: "Account — ContractConsel",
};

export default function AccountPage() {
  return (
    <AppShell>
      <main className="flex-1 overflow-y-auto">
        <AccountSettings />
      </main>
    </AppShell>
  );
}
