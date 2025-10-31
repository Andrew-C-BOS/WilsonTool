"use client";

export default function LogoutButton() {
  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/"; // send back to home
    } catch (err) {
      console.error("Logout failed", err);
    }
  }

  return (
    <button
      onClick={handleLogout}
      className="rounded-md bg-gray-800 text-white text-sm px-3 py-1.5 hover:bg-gray-900 transition"
    >
      Logout
    </button>
  );
}
