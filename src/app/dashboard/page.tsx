import { redirect } from 'next/navigation'

/** Legacy route retained as a stable redirect; /home is the sole dashboard. */
export default function DashboardRedirect() {
  redirect('/home')
}
