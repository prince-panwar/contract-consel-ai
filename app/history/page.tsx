import { AppShell } from "@/components/AppShell";
import { HistoryList } from "@/components/HistoryList";

export const metadata = {
  title: "History — ContractCounsel",
};

export default function HistoryPage() {
  return (
    <AppShell>
      <main className="flex-1 overflow-y-auto">
        <HistoryList />
      </main>
    </AppShell>
  );
}
