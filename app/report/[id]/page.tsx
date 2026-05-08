import { AppShell } from "@/components/AppShell";
import { Workbench } from "@/components/Workbench";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ReportPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <AppShell>
      <Workbench reportId={id} />
    </AppShell>
  );
}
