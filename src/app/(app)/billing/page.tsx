import { listBilling, listClientOptions } from "@/lib/data/billing";
import { BillingClient } from "./billing-client";

/**
 * BILLING — brokerage invoices and quotes.
 *
 * Server Component does the data fetch (invoices + quotes + client options)
 * and hands plain data to the Client Component, which owns the tab filtering,
 * search, and the create/send/convert interactions. Same Server + Client split
 * as the Shipments page.
 */
export default async function BillingPage() {
  const [docs, clients] = await Promise.all([listBilling(), listClientOptions()]);
  return <BillingClient docs={docs} clients={clients} />;
}
