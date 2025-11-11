"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

type LookupResp =
  | {
      ok: true;
      invite: {
        emailMasked: string;
        role: "primary" | "co_applicant" | "cosigner";
        householdLine?: string | null;
        expiresAtISO: string;
        isLoggedIn: boolean;
      };
    }
  | { ok: false; error: string };

export default function JoinClient({ code }: { code: string }) {
  const router = useRouter();

  const [stage, setStage] = useState<"lookup" | "send" | "verify">("lookup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meta, setMeta] = useState<{
    emailMasked: string;
    role: "primary" | "co_applicant" | "cosigner";
    householdLine?: string | null;
    expiresAtISO: string;
    isLoggedIn: boolean;
  } | null>(null);

  const [otp, setOtp] = useState("");
  const [resendAt, setResendAt] = useState<number>(0);
  const [now, setNow] = useState<number>(() => Date.now());
  const otpRef = useRef<HTMLInputElement | null>(null);

  // NEW: prompt to allow switching session to invited account
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

  async function lookup() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/join/lookup?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      const json: LookupResp = await res.json();
      if (!json.ok) throw new Error(json.error || "invalid_link");
      setMeta(json.invite);
      setStage("send");
    } catch (e: any) {
      setError(e?.message || "Something went wrong,");
    } finally {
      setBusy(false);
    }
  }

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
        throw new Error(json?.error || "send_failed");
      }

      setResendAt(Date.now() + 30_000);
      setTimeout(() => otpRef.current?.focus(), 0);
    } catch (e: any) {
      setStage("send");
      setError(e?.message || "Couldn’t send the verification email,");
    } finally {
      setBusy(false);
    }
  }

  // UPDATED: allow forcing a switch when server says wrong_email
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
        body: JSON.stringify({ code, otp: clean, switch: !!opts?.forceSwitch }),
      });
      const json = await res.json();

      if (!json?.ok) {
        if (json?.error === "wrong_email") {
          setNeedsSwitchConfirm(true);
          setError("This invite is for a different email,");
          return;
        }
        throw new Error(json?.error || "verify_failed");
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

  useEffect(() => {
    lookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {stage === "lookup" && <div className="text-sm text-gray-600">Checking your invite…</div>}

      {stage !== "lookup" && meta && (
        <>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
            <div className="text-gray-700">
              <span className="font-semibold">Invited email:</span> {meta.emailMasked}
            </div>
            <div className="text-gray-700">
              <span className="font-semibold">Role:</span> {meta.role.replace("_", " ")}
            </div>
            {meta.householdLine && (
              <div className="text-gray-700">
                <span className="font-semibold">Household:</span> {meta.householdLine}
              </div>
            )}
            <div className="text-gray-700">
              <span className="font-semibold">Expires:</span>{" "}
              {new Date(meta.expiresAtISO).toLocaleString()}
            </div>
          </div>

          {stage === "send" && (
            <div className="mt-4">
              <button
                onClick={sendVerification}
                disabled={busy}
                className={clsx(
                  "inline-flex w-full items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold",
                  busy ? "bg-gray-300 text-gray-600" : "bg-gray-900 text-white hover:bg-black"
                )}
              >
                {busy ? "Sending…" : `Send verification code to ${meta.emailMasked}`}
              </button>
              {!meta.isLoggedIn && (
                <p className="mt-2 text-center text-xs text-gray-500">
                  No account? We’ll create one after you verify this email,
                </p>
              )}
            </div>
          )}

          {stage === "verify" && (
            <div className="mt-4 space-y-3">
              {/* Switch confirm banner */}
              {needsSwitchConfirm && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  This invite was sent to a different email, you can switch to the invited account, and continue,
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
                <label className="text-sm font-medium text-gray-900">Verification code</label>
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
                <p className="mt-1 text-xs text-gray-500">Enter the 6-digit code we emailed you,</p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={() => completeJoin()}
                  disabled={busy || otp.length !== 6}
                  className={clsx(
                    "inline-flex flex-1 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold",
                    busy || otp.length !== 6
                      ? "bg-gray-300 text-gray-600"
                      : "bg-indigo-600 text-white hover:bg-indigo-700"
                  )}
                >
                  {busy ? "Verifying…" : "Verify & Join"}
                </button>

                <button
                  onClick={sendVerification}
                  disabled={busy || resendSeconds > 0}
                  className={clsx(
                    "inline-flex flex-1 items-center justify-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold",
                    resendSeconds > 0 ? "text-gray-500" : "text-gray-900 hover:bg-gray-50"
                  )}
                  title={resendSeconds > 0 ? `You can resend in ${resendSeconds}s` : "Resend code"}
                >
                  {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
                </button>
              </div>

              <p className="text-xs text-gray-500">
                If you’re logged in and your current household has multiple members, you won’t be able to switch,
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
