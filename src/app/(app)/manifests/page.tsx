import { listAgentOptions, listManifests, listVoyageOptions } from "@/lib/data/manifests";
import { ManifestsView } from "./manifests-view";

/**
 * Manifests — Server Component fetches via the lib/data seam (same pattern as
 * /shipments) and hands rows plus the picker options to the client view.
 */
export default async function ManifestsPage() {
  const [rows, voyages, agents] = await Promise.all([
    listManifests(),
    listVoyageOptions(),
    listAgentOptions(),
  ]);
  return <ManifestsView initialRows={rows} voyages={voyages} agents={agents} />;
}
