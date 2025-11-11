// app/join/[code]/JoinMobile.tsx

import JoinClient from "./JoinClient";
import { UserPlus } from "lucide-react";

export default function JoinMobile({ code }: { code: string }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-6">
      <div className="rounded-xl bg-white p-5 shadow">
        <h1 className="flex items-center text-xl font-semibold text-gray-900">
          <UserPlus className="mr-2 h-5 w-5 text-indigo-500" />
          Join a household
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Confirm your email, then we’ll link you to the household,
        </p>

        <div className="mt-4">
          <JoinClient code={code} />
        </div>
      </div>
    </main>
  );
}
