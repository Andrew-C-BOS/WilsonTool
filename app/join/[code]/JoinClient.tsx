"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

// Server should drive these; keep them tolerant while you wire APIs
type InviteMatch = "anon" | "email_match" | "email_mismatch" | "already_member";

type InviteMeta = {
  emailMasked: string;
  emailRaw?: string;
  role: "primary" | "co_applicant" | "cosigner";
  householdLine?: string | null;
  expiresAtISO: string;
  status?: "active" | "expired" | "redeemed";
  isLoggedIn: boolean;
  sessionEmail?: string | null;
  match?: InviteMatch;
};

type LookupResp =
  | {
      ok: true;
      invite: InviteMeta;
    }
  | { ok: false; error: string };

type Stage =
  | "loading"
  | "invalid"        // invalid/expired/used
  | "anon"           // not logged in
  | "confirm_join"   // email_match
  | "mismatch"       // email_mismatch
  | "verify"         // OTP entry
  | "already_member";

export default function JoinClient({ code }: { code: string }) {
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meta, setMeta] = useState<InviteMeta | null>(null);

  const [otp, setOtp] = useState("");
  const [resendAt, setResendAt] = useState<number>(0);
  const [now, setNow] = useState<number>(() => Date.now());
  const otpRef = useRef<HTMLInputElement | null>(null);

  // Whether we need an extra confirm when server says "wrong_email"
  const [needsSwitchConfirm, setNeedsSwitchConfirm] = useState(false);

  const resendSeconds = useMemo(() => {
    const left = Math.ceil((resendAt - now) / 1000);
    return left > 0 ? left : 0;
  }, [resendAt, now]);

  useEffect(() => {
    if (!resendAt) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [resendAt]);

  /* ───────────────────────────────────────────────────────────
     Lookup: figure out what kind of flow this is
  ─────────────────────────────────────────────────────────── */
  async function lookup() {
    setBusy(true);
    setError(null);
    setStage("loading");

    try {
      const res = await fetch(
        `/api/join/lookup?code=${encodeURIComponent(code)}`,
        { cache: "no-store" },
      );
      const json: LookupResp = await res.json();
      if (!json.ok) {
        setError(json.error || "This invite is no longer active,");
        setStage("invalid");
        return;
      }

      const invite = json.invite;
      setMeta(invite);

      const status = invite.status ?? "active";

      if (status !== "active") {
        setError("This invite is no longer active,");
        setStage("invalid");
        return;
      }

      // Fallback if match not provided yet
      const match: InviteMatch =
        invite.match ||
        (!invite.isLoggedIn
          ? "anon"
          : "email_match"); // temporary default until backend wired

      switch (match) {
        case "anon":
          setStage("anon");
          break;
        case "email_match":
          setStage("confirm_join");
          break;
        case "email_mismatch":
          setStage("mismatch");
          break;
        case "already_member":
          setStage("already_member");
          break;
        default:
          setStage("anon");
      }
    } catch (e: any) {
      setError(e?.message || "Something went wrong,");
      setStage("invalid");
    } finally {
      setBusy(false);
    }
  }

  /* ───────────────────────────────────────────────────────────
     Direct join when email matches
  ─────────────────────────────────────────────────────────── */
  async function joinDirect() {
    if (!meta) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/join/simple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Couldn’t join this household,");
      }

      router.replace("/tenant/household");
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Couldn’t join this household,");
    } finally {
      setBusy(false);
    }
  }

  /* ───────────────────────────────────────────────────────────
     OTP send/verify path (for mismatch flow)
  ─────────────────────────────────────────────────────────── */
  async function sendVerification() {
    if (resendSeconds > 0) return;
    setBusy(true);
    setError(null);
    setStage("verify");

    try {
      const res = await fetch(`/api/join/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        if (json?.error?.toLowerCase?.() === "too_soon") {
          setResendAt(Date.now() + 30_000);
          return;
        }
        throw new Error(json?.error || "Couldn’t send the verification email,");
      }

      setResendAt(Date.now() + 30_000);
      setTimeout(() => otpRef.current?.focus(), 0);
    } catch (e: any) {
      // Go back to mismatch screen on failure
      setStage("mismatch");
      setError(e?.message || "Couldn’t send the verification email,");
    } finally {
      setBusy(false);
    }
  }

  async function completeJoin(opts?: { forceSwitch?: boolean }) {
    const clean = otp.replace(/\D/g, "").slice(0, 6);
    if (clean.length !== 6) {
      setError("Enter the 6-digit code,");
      return;
    }

    setBusy(true);
    setError(null);
    setNeedsSwitchConfirm(false);

    try {
      const res = await fetch(`/api/join/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          otp: clean,
          switch: !!opts?.forceSwitch,
        }),
      });
      const json = await res.json();

      if (!json?.ok) {
        if (json?.error === "wrong_email") {
          setNeedsSwitchConfirm(true);
          setError("This invite is for a different email,");
          return;
        }
        throw new Error(json?.error || "Verification failed,");
      }

      router.replace("/tenant/household");
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Verification failed,");
    } finally {
      setBusy(false);
    }
  }

  function onOtpChange(v: string) {
    const clean = v.replace(/\D/g, "").slice(0, 6);
    setOtp(clean);
  }

  function onOtpKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && otp.length === 6 && !busy) {
      e.preventDefault();
      void completeJoin();
    }
  }

  /* ───────────────────────────────────────────────────────────
     Initial lookup
  ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    lookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const invitedEmail = meta?.emailMasked ?? "";
  const sessionEmail = meta?.sessionEmail ?? null;

  const loginUrl = `/register?mode=signin&next=${encodeURIComponent(`/join/${code}`)}`;
  const signupUrl = `/register?mode=signup&next=${encodeURIComponent(`/join/${code}`)}`;

  /* ───────────────────────────────────────────────────────────
     Render
  ─────────────────────────────────────────────────────────── */
  return (
    <div>
      {error && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Only show "Checking…" when truly loading and no fatal error */}
      {stage === "loading" && !error && (
        <div className="text-sm text-gray-600">Checking your invite…</div>
      )}

      {meta && stage !== "loading" && (
        <>
          {/* Invite summary */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
            <div className="text-gray-700">
              <span className="font-semibold">Invited email:</span>{" "}
              {meta.emailMasked}
            </div>
            <div className="text-gray-700">
              <span className="font-semibold">Role:</span>{" "}
              {meta.role.replace("_", " ")}
            </div>
            {meta.householdLine && (
              <div className="text-gray-700">
                <span className="font-semibold">Household:</span>{" "}
                {meta.householdLine}
              </div>
            )}
            <div className="text-gray-700">
              <span className="font-semibold">Expires:</span>{" "}
              {new Date(meta.expiresAtISO).toLocaleString()}
            </div>
            {sessionEmail && (
              <div className="mt-1 text-[11px] text-gray-500">
                You’re currently logged in as{" "}
                <span className="font-semibold">{sessionEmail}</span>,
              </div>
            )}
          </div>

          {/* Invalid / inactive invite */}
          {stage === "invalid" && (
            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
              <div className="font-semibold text-gray-900">
                This invite is no longer active,
              </div>
              <p className="mt-1 text-xs text-gray-600">
                The link may have expired or already been used. Reach out to your
                property manager if you believe this is a mistake,
              </p>
            </div>
          )}

          {/* Stage: anonymous user */}
          {stage === "anon" && (
            <div className="mt-4 space-y-3 text-sm">
              <p className="text-gray-700">
                To join this household, log in or create an account. Once you’re signed
                in, we’ll attach this invite to your tenant profile,
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => router.push(loginUrl)}
                  className="inline-flex flex-1 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => router.push(signupUrl)}
                  className="inline-flex flex-1 items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black"
                >
                  Create account
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Use the same email this invite was sent to if possible,
              </p>
            </div>
          )}

          {/* Stage: already member */}
          {stage === "already_member" && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <div className="font-semibold">
                You’re already part of this household,
              </div>
              <p className="mt-1 text-xs text-emerald-800">
                You don’t need to do anything else with this invite,
              </p>
              <button
                type="button"
                onClick={() => {
                  router.replace("/tenant/household");
                  router.refresh();
                }}
                className="mt-3 inline-flex items-center justify-center rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Go to your household
              </button>
            </div>
          )}

          {/* Stage: email match – simple confirm and join */}
          {stage === "confirm_join" && (
            <div className="mt-4 space-y-3 text-sm">
              <p className="text-gray-700">
                This invite was sent to{" "}
                <span className="font-semibold">{invitedEmail}</span>, and you’re
                logged in as{" "}
                <span className="font-semibold">{sessionEmail}</span>. You can join
                this household with your current account,
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={joinDirect}
                  disabled={busy}
                  className={clsx(
                    "inline-flex flex-1 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold",
                    busy
                      ? "bg-gray-300 text-gray-600"
                      : "bg-gray-900 text-white hover:bg-black",
                  )}
                >
                  {busy ? "Joining…" : "Join this household"}
                </button>
                <button
                  type="button"
                  onClick={() => router.push(loginUrl)}
                  className="inline-flex flex-1 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"
                >
                  Switch accounts
                </button>
              </div>
            </div>
          )}

          {/* Stage: mismatch – explain, then offer verify path */}
          {stage === "mismatch" && (
            <div className="mt-4 space-y-3 text-sm">
              <p className="text-gray-700">
                This invite was sent to{" "}
                <span className="font-semibold">{invitedEmail}</span>, but you’re
                currently signed in as{" "}
                <span className="font-semibold">
                  {sessionEmail || "your current account"}
                </span>.
              </p>
              <p className="text-xs text-gray-600">
                If you meant to join as the invited email, switch accounts and sign in
                with that address. If you want to join with your current account instead,
                we’ll send you a verification code to confirm,
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => router.push(loginUrl)}
                  className="inline-flex flex-1 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"
                >
                  Switch accounts
                </button>
                <button
                  type="button"
                  onClick={sendVerification}
                  disabled={busy}
                  className={clsx(
                    "inline-flex flex-1 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold",
                    busy
                      ? "bg-gray-300 text-gray-600"
                      : "bg-indigo-600 text-white hover:bg-indigo-700",
                  )}
                >
                  {busy ? "Sending…" : "Verify & join with this account"}
                </button>
              </div>
            </div>
          )}

          {/* Stage: verify – OTP entry */}
          {stage === "verify" && (
            <div className="mt-4 space-y-3">
              {needsSwitchConfirm && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  This invite was sent to a different email, you can switch to the invited
                  account and continue,
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => completeJoin({ forceSwitch: true })}
                      className="inline-flex items-center justify-center rounded-md bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700"
                    >
                      Switch & Continue
                    </button>
                    <button
                      onClick={() => setNeedsSwitchConfirm(false)}
                      className="inline-flex items-center justify-center rounded-md border border-gray-200 px-3 py-1.5 font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Stay Signed In
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-gray-900">
                  Verification code
                </label>
                <input
                  ref={otpRef}
                  value={otp}
                  onChange={(e) => onOtpChange(e.target.value)}
                  onKeyDown={onOtpKeyDown}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6-digit code"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm tracking-widest"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Enter the 6-digit code we emailed you,
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={() => completeJoin()}
                  disabled={busy || otp.length !== 6}
                  className={clsx(
                    "inline-flex flex-1 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold",
                    busy || otp.length !== 6
                      ? "bg-gray-300 text-gray-600"
                      : "bg-indigo-600 text-white hover:bg-indigo-700",
                  )}
                >
                  {busy ? "Verifying…" : "Verify & Join"}
                </button>

                <button
                  onClick={sendVerification}
                  disabled={busy || resendSeconds > 0}
                  className={clsx(
                    "inline-flex flex-1 items-center justify-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold",
                    resendSeconds > 0
                      ? "text-gray-500"
                      : "text-gray-900 hover:bg-gray-50",
                  )}
                  title={
                    resendSeconds > 0
                      ? `You can resend in ${resendSeconds}s`
                      : "Resend code"
                  }
                >
                  {resendSeconds > 0
                    ? `Resend in ${resendSeconds}s`
                    : "Resend code"}
                </button>
              </div>

              <p className="text-xs text-gray-500">
                If you’re logged in and your current household has multiple members, you won’t
                be able to switch,
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
