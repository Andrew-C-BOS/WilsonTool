import { redirect } from "next/navigation";
import { getSessionUser, isAppAdmin } from "@/lib/auth";
import AdminPanel from "./AdminPanel";

export const dynamic = "force-dynamic";

/**
 * Entry point for the admin dashboard.
 * Only app-level admins can access this page.
 */
export default async function AdminPage() {
  const user = await getSessionUser();

  // Reject non-admins and unauthenticated users
  if (!isAppAdmin(user)) {
    redirect("/");
  }

  return <AdminPanel />;
}
