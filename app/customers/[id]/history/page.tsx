import { notFound } from "next/navigation";

import CustomerHistoryWorkspace from "./CustomerHistoryWorkspace";

type PageProps = { params: Promise<{ id: string }> };

export default async function CustomerHistoryPage({ params }: PageProps) {
  const { id } = await params;
  const customerId = Number(id);

  if (!Number.isInteger(customerId) || customerId < 1) {
    notFound();
  }

  return <CustomerHistoryWorkspace customerId={customerId} />;
}
