/**
 * Manifests — placeholder.
 * This route follows one of the two canonical patterns already built:
 *   • List pages (Manifests, Clients, Billing, Accounting, Home) mirror
 *     /shipments  — a Server Component fetches via a lib/data seam and passes
 *     rows to a Client Component for filtering/search.
 *   • The Clients page additionally uses a master-detail split.
 * Ask Claude to generate this page next and it will drop in here.
 */
export default function ManifestsPage() {
  return (
    <div className="sb-page">
      <h1 className="sb-h1">Manifests</h1>
      <p className="sb-meta" style={{ marginTop: 8 }}>
        This page is scaffolded. It follows the same Server + Client pattern as
        the Shipments page — ready to be built out next.
      </p>
    </div>
  );
}
