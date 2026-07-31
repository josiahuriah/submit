import { listNewShipmentOptions } from "@/lib/data/shipment-actions";
import { NewShipmentForm } from "./new-shipment-form";

/** New shipment — Server Component fetches the picker options, form is client. */
export default async function NewShipmentPage() {
  const options = await listNewShipmentOptions();
  return <NewShipmentForm options={options} />;
}
