// app/join/[code]/JoinDesktop.tsx
"use client";

import JoinClient from "./JoinClient";
import { UserPlus } from "lucide-react";

export default function JoinDesktop({ code }: { code: string }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 rounded-xl bg-white p-6 shadow">
        <h1 className="flex items-center text-2xl font-semibold text-gray-900">
          <UserPlus className="mr-2 h-6 w-6 text-indigo-500" />
          Join a household
        </h1>
        <p className="mt-2 text-gray-600">
          Confirm your email, then we’ll link you to the household,
        </p>
      </header>

      <section className="rounded-xl bg-white p-6 shadow">
        <JoinClient code={code} />
      </section>
    </main>
  );
}
