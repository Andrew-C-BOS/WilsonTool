"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, ArrowRight } from "lucide-react";

// ----------- lightweight clsx + Card + Buttons -------------
function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

function Card({
  title,
  titleIcon,
  children,
}: {
  title: string;
  titleIcon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 border-l-4 border-gray-200">
      <div className="mb-3 flex items-center gap-3">
        {titleIcon}
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="text-sm text-gray-700">{children}</div>
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition";
  const tone = disabled
    ? "bg-gray-300 text-gray-600 cursor-not-allowed"
    : "bg-indigo-600 hover:bg-indigo-700 text-white";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(base, tone, className)}
    >
      {children}
    </button>
  );
}

function GhostButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "inline-flex items-center justify-center rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-900 bg-white/80 backdrop-blur hover:bg-gray-50 transition",
        disabled && "opacity-60 cursor-not-allowed",
        className,
      )}
    >
      {children}
    </button>
  );
}
// ----------------------------------------------------------

// incoming invite type
type IncomingInvite = {
  id: string;
  householdName?: string | null;
  inviterName?: string | null;
  role: string;
  createdAt: string;
  expiresAt: string;
};

const INTRO_FIRST_DELAY = 1200;
const INTRO_SECOND_DELAY = 3000;

// wizard steps
type WizardStep =
  | "invites"
  | "name"
  | "display"
  | "coApplicants"
  | "cosigners"
  | "done";

// animal-based random name generator
const ANIMALS = [
  "Bear",
  "Tiger",
  "Cheetah",
  "Fox",
  "Otter",
  "Panda",
  "Falcon",
  "Hawk",
  "Eagle",
  "Lynx",
  "Wolf",
  "Cougar",
  "Leopard",
  "Badger",
  "Bison",
  "Moose",
  "Orca",
  "Dolphin",
  "Heron",
  "Crane",
  "Sparrow",
  "Robin",
  "Raven",
  "Jay",
  "Finch",
  "Wren",
  "Koala",
  "Penguin",
  "Seal",
  "Walrus",
  "Beaver",
  "Hedgehog",
  "Ibex",
  "Gazelle",
  "Antelope",
  "Mink",
  "Ferret",
  "Ocelot",
  "Tapir",
  "Manatee",
  "Lemur",
  "Jackal",
  "Sable",
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateAnimalTriplet(): string {
  if (ANIMALS.length < 3) {
    return "MILO · Household · 2025";
  }

  let first = randomFrom(ANIMALS);
  let second = randomFrom(ANIMALS);
  let third = randomFrom(ANIMALS);

  const used = new Set<string>([first]);
  while (used.has(second)) second = randomFrom(ANIMALS);
  used.add(second);
  while (used.has(third)) third = randomFrom(ANIMALS);

  return `${first} · ${second} · ${third}`;
}

export default function HouseholdWizardMobile() {
  const router = useRouter();

  const [incoming, setIncoming] = useState<IncomingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);

  // invites → name household → display name → co-apps → cosigners → done
  const [wizardStep, setWizardStep] = useState<WizardStep>("invites");

  // intro animation stage
  const [introStage, setIntroStage] = useState<0 | 1 | 2 | 3>(0);

  // did this user join an existing household from an invite?
  const [joinedFromInvite, setJoinedFromInvite] = useState(false);
  const [joinedHouseholdName, setJoinedHouseholdName] = useState<string | null>(
    null,
  );

  // name household state
  const [householdName, setHouseholdName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // display name state
  const [displayName, setDisplayName] = useState("");
  const [savingDisplay, setSavingDisplay] = useState(false);
  const [displayError, setDisplayError] = useState<string | null>(null);

  // co-applicants state
  const [coCount, setCoCount] = useState<number>(0);
  const [coEmails, setCoEmails] = useState<string[]>([]);
  const [sendingCoInvites, setSendingCoInvites] = useState(false);
  const [coError, setCoError] = useState<string | null>(null);

  // cosigners state
  const [cosEmails, setCosEmails] = useState<string[]>([""]);
  const [sendingCosInvites, setSendingCosInvites] = useState(false);
  const [cosError, setCosError] = useState<string | null>(null);

  // fetch incoming invites
  async function fetchIncoming() {
    try {
      const res = await fetch("/api/tenant/household/invites/incoming?me=1", {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json?.ok) throw new Error();
      setIncoming(json.invites || []);
    } catch {
      setIncoming([]);
    } finally {
      setLoading(false);
    }
  }

  async function joinInvite(inviteId: string) {
    setJoining(true);
    try {
      const res = await fetch("/api/tenant/household/invites/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "join_failed");

      const inv = incoming.find((i) => i.id === inviteId);
      setJoinedFromInvite(true);
      setJoinedHouseholdName(inv?.householdName ?? null);

      // skip naming + invite steps, go straight to display-name step
      setWizardStep("display");
    } catch (e) {
      console.error(e);
    } finally {
      setJoining(false);
    }
  }

  function continueWithoutInvite() {
    setWizardStep("name");
  }

  async function saveHouseholdName() {
    const name = householdName.trim();
    if (!name) {
      setNameError("Please enter a name for your household,");
      return;
    }
    setNameError(null);
    setSavingName(true);
    try {
      const res = await fetch("/api/tenant/household/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "rename_failed");

      setWizardStep("display");
    } catch (e) {
      console.error(e);
      setNameError("We couldn’t save that name, please try again,");
    } finally {
      setSavingName(false);
    }
  }

  async function saveDisplayName() {
    const dn = displayName.trim();
    if (!dn) {
      setDisplayError("Please enter how you’d like to be addressed,");
      return;
    }
    setDisplayError(null);
    setSavingDisplay(true);
    try {
      const res = await fetch("/api/tenant/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredName: dn }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "save_failed");

      if (joinedFromInvite) {
        setWizardStep("done");
      } else {
        setWizardStep("coApplicants");
      }
    } catch (e) {
      console.error(e);
      setDisplayError("We couldn’t save that name, please try again,");
    } finally {
      setSavingDisplay(false);
    }
  }

  // helper to send invites
  async function sendInvites(emails: string[], role: "co_applicant" | "cosigner") {
    const cleaned = Array.from(
      new Set(emails.map((e) => e.trim()).filter(Boolean)),
    );
    if (cleaned.length === 0) return;

    await Promise.all(
      cleaned.map(async (email) => {
        const res = await fetch("/api/tenant/household/invites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, role }),
        });
        const json = await res.json();
        if (!json?.ok) throw new Error(json?.error || "invite_failed");
      }),
    );
  }

  async function handleSendCoInvites() {
    const cleaned = coEmails.map((e) => e.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      setWizardStep("cosigners");
      return;
    }

    setSendingCoInvites(true);
    setCoError(null);
    try {
      await sendInvites(cleaned, "co_applicant");
      setWizardStep("cosigners");
    } catch (e) {
      console.error(e);
      setCoError(
        "We couldn’t send one or more invites, you can fix emails or try again,",
      );
    } finally {
      setSendingCoInvites(false);
    }
  }

  async function handleSendCosInvites() {
    const cleaned = cosEmails.map((e) => e.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      setWizardStep("done");
      return;
    }

    setSendingCosInvites(true);
    setCosError(null);
    try {
      await sendInvites(cleaned, "cosigner");
      setWizardStep("done");
    } catch (e) {
      console.error(e);
      setCosError(
        "We couldn’t send one or more invites, you can adjust and try again,",
      );
    } finally {
      setSendingCosInvites(false);
    }
  }

  useEffect(() => {
    fetchIncoming();
  }, []);

  // intro animation timers
  useEffect(() => {
    setIntroStage(0);

    const t1 = setTimeout(() => setIntroStage(1), INTRO_FIRST_DELAY);
    const t2 = setTimeout(() => setIntroStage(2), INTRO_SECOND_DELAY);
    const t3 = setTimeout(() => setIntroStage(3), INTRO_SECOND_DELAY + 600);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  return (
    <>
      {/* ---------- FULL-SCREEN INTRO OVERLAY ---------- */}
      {introStage < 3 && (
        <div
          className={clsx(
            "fixed inset-0 z-40 flex items-center justify-center bg-white text-slate-900 transition-opacity duration-700",
            "h-[100dvh] overflow-hidden",
            introStage === 2 && "opacity-0 pointer-events-none",
          )}
        >
          {/* soft central blob background */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-56 w-56 sm:h-72 sm:w-72">
              <div className="absolute inset-0 rounded-full bg-purple-400/40 blur-3xl opacity-80 animate-pulse" />
              <div className="absolute -left-8 -top-8 h-36 w-36 rounded-full bg-amber-300/45 blur-3xl animate-[pulse_4s_ease-in-out_infinite]" />
              <div className="absolute -right-8 bottom-0 h-40 w-40 rounded-full bg-sky-300/50 blur-3xl animate-[pulse_5s_ease-in-out_infinite]" />
            </div>
          </div>

          {/* intro text */}
          <div className="relative z-10 px-6 text-center transform transition-all duration-700">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700/70">
              Welcome
            </div>

            <h1 className="text-3xl font-semibold text-slate-800">
              Welcome to MILO
            </h1>

            <p
              className={clsx(
                "mt-4 text-sm text-slate-700/80 transition-opacity duration-700",
                introStage >= 1 ? "opacity-100" : "opacity-0",
              )}
            >
              Let’s set up your household and get you ready to apply,
            </p>
          </div>
        </div>
      )}

      {/* ---------- MAIN WIZARD PAGE ---------- */}
      <main className="min-h-[calc(100vh-4rem)] bg-[#e6edf1]">
        <div className="mx-auto max-w-3xl px-4 py-8 space-y-8">
          {/* ---------- WELCOME HERO ---------- */}
          <section className="relative overflow-hidden rounded-3xl bg-slate-950 px-4 py-8 text-center text-white shadow-sm">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950" />
              <div className="absolute -left-16 -top-16 h-52 w-52 rounded-full bg-indigo-500/35 blur-3xl" />
              <div className="absolute right-[-40px] top-6 h-52 w-52 rounded-full bg-emerald-400/30 blur-3xl" />
              <div className="absolute bottom-[-40px] left-4 h-56 w-56 rounded-full bg-violet-500/30 blur-3xl" />
            </div>

            <div className="relative z-10 space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1 text-[11px] font-semibold backdrop-blur">
                <span className="relative inline-flex h-3 w-3 items-center justify-center">
                  <span className="absolute inline-flex h-3 w-3 rounded-full bg-emerald-400/40 animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                <span>Welcome to MILO</span>
                <span className="mx-1 opacity-50">·</span>
                <span>Household setup</span>
              </div>

              <h1 className="text-2xl font-semibold sm:text-3xl">
                Let’s set up your household,
              </h1>
              <p className="mx-auto max-w-md text-sm text-slate-100/85 leading-relaxed">
                We’ll make sure you’re linked to the right people before you apply. 
                You’ll check for invites, name your household, choose your display name, 
                and invite anyone who should be on the lease with you,
              </p>
            </div>
          </section>

          {/* ---------- STEP CONTENT ---------- */}
          {wizardStep === "invites" && (
            <Card
              title="Household invites"
              titleIcon={<Users className="h-5 w-5 text-indigo-500" />}
            >
              {loading ? (
                <p className="text-sm text-gray-600">Checking for invites…</p>
              ) : incoming.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600">
                    We didn’t find any active invites for your email,
                  </p>
                  <p className="text-xs text-gray-500">
                    Your household will start with just you, you can always invite roommates or
                    cosigners later from your household page,
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {incoming.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3"
                    >
                      <div className="min-w-0 text-left">
                        <div className="truncate text-sm font-medium text-gray-900">
                          {inv.householdName || "Unnamed household"}
                        </div>
                        <div className="mt-1 text-xs text-gray-600">
                          Invited by: {inv.inviterName || "someone"} · Role:{" "}
                          {inv.role.replace("_", " ")}
                        </div>
                      </div>

                      <PrimaryButton
                        onClick={() => joinInvite(inv.id)}
                        disabled={joining}
                        className="shrink-0"
                      >
                        {joining ? "Joining…" : "Join"}
                      </PrimaryButton>
                    </div>
                  ))}
                  <p className="text-xs text-gray-500">
                    Joining an invite will connect your application to this household,
                  </p>
                </div>
              )}

              {/* continue without invite CTA */}
              <div className="mt-5 flex flex-col gap-2 border-t border-gray-100 pt-4 text-xs text-gray-600">
                <p className="text-[11px] text-gray-400">
                  Don’t see an invite? You can still continue and invite others later from your
                  household page,
                </p>
                <PrimaryButton
                  onClick={continueWithoutInvite}
                  disabled={joining}
                  className="w-full"
                >
                  Continue without invite
                  <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </PrimaryButton>
              </div>
            </Card>
          )}

          {wizardStep === "name" && (
            <Card
              title="Name your household"
              titleIcon={<Users className="h-5 w-5 text-indigo-500" />}
            >
              <div className="space-y-4">
                <p className="text-sm text-gray-200/90">
                  This is how your household will appear to landlords and property managers inside
                  MILO,
                </p>
                <p className="text-xs text-gray-500">
                  Keep it short and recognizable. For example “Bear · Tiger · Cheetah” or 
                  “Otter · Falcon · Lynx,”
                </p>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-gray-700">
                    Household name
                  </label>
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={householdName}
                      onChange={(e) => {
                        setHouseholdName(e.target.value);
                        if (nameError) setNameError(null);
                      }}
                      placeholder="e.g., Bear · Tiger · Cheetah"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <GhostButton
                      onClick={() => {
                        setHouseholdName(generateAnimalTriplet());
                        if (nameError) setNameError(null);
                      }}
                      className="w-full"
                    >
                      Surprise me
                    </GhostButton>
                  </div>
                  {nameError && (
                    <p className="mt-1 text-[11px] text-rose-600">{nameError}</p>
                  )}
                  <p className="mt-1 text-[11px] text-gray-500">
                    Landlords will see this name alongside your application and lease,
                  </p>
                </div>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-between">
                  <GhostButton
                    onClick={() => setWizardStep("invites")}
                    disabled={savingName}
                    className="w-full sm:w-auto"
                  >
                    Back to invites
                  </GhostButton>
                  <PrimaryButton
                    onClick={saveHouseholdName}
                    disabled={savingName || !householdName.trim()}
                    className="w-full sm:w-auto"
                  >
                    {savingName ? "Saving…" : "Save and continue"}
                    {!savingName && <ArrowRight className="ml-1 h-3.5 w-3.5" />}
                  </PrimaryButton>
                </div>
              </div>
            </Card>
          )}

          {wizardStep === "display" && (
            <Card
              title="Choose your display name"
              titleIcon={<Users className="h-6 w-6 text-indigo-500" />}
            >
              <div className="space-y-4">
                <p className="text-sm text-gray-700">
                  This is the name other household members and your landlord will use when they
                  speak with you,
                </p>
                <p className="text-xs text-gray-500">
                  Use whatever you’re comfortable with in conversation. For example “Andrew”, 
                  “Andrew C,” or “Drew,”
                </p>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-gray-700">
                    Display name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => {
                      setDisplayName(e.target.value);
                      if (displayError) setDisplayError(null);
                    }}
                    placeholder="e.g., Andrew C,"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  {displayError && (
                    <p className="mt-1 text-[11px] text-rose-600">{displayError}</p>
                  )}
                  <p className="mt-1 text-[11px] text-gray-500">
                    Other household members and your landlord will see this name in chat, in
                    applications, and in their dashboards,
                  </p>
                </div>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-between">
                  <GhostButton
                    onClick={() =>
                      joinedFromInvite ? setWizardStep("invites") : setWizardStep("name")
                    }
                    disabled={savingDisplay}
                    className="w-full sm:w-auto"
                  >
                    Back
                  </GhostButton>
                  <PrimaryButton
                    onClick={saveDisplayName}
                    disabled={savingDisplay || !displayName.trim()}
                    className="w-full sm:w-auto"
                  >
                    {savingDisplay ? "Saving…" : "Save and continue"}
                    {!savingDisplay && <ArrowRight className="ml-1 h-3.5 w-3.5" />}
                  </PrimaryButton>
                </div>
              </div>
            </Card>
          )}

          {wizardStep === "coApplicants" && (
            <Card
              title="Invite co-applicants"
              titleIcon={<Users className="h-6 w-6 text-indigo-500" />}
            >
              <div className="space-y-4">
                <p className="text-sm text-gray-700">
                  Co-applicants are adults (18+) who will live in the home and sign the lease with
                  you,
                </p>
                <p className="text-xs text-gray-500">
                  We’ll email them an invite so they can complete their part of the application
                  under the same household,
                </p>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-gray-700">
                    How many co-applicants do you plan to have?
                  </label>
                  <select
                    value={coCount}
                    onChange={(e) => {
                      const n = Number(e.target.value) || 0;
                      setCoCount(n);
                      setCoEmails(Array(n).fill(""));
                      setCoError(null);
                    }}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value={0}>0</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                  </select>
                </div>

                {coCount > 0 && (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500">
                      Enter their email addresses, we’ll send each person a separate invite,
                    </p>
                    {Array.from({ length: coCount }).map((_, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="email"
                          value={coEmails[idx] || ""}
                          onChange={(e) => {
                            const next = [...coEmails];
                            next[idx] = e.target.value;
                            setCoEmails(next);
                            if (coError) setCoError(null);
                          }}
                          placeholder={`Co-applicant ${idx + 1} email`}
                          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {coError && (
                  <p className="mt-1 text-[11px] text-rose-600">{coError}</p>
                )}

                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-between">
                  <GhostButton
                    onClick={() => setWizardStep("display")}
                    disabled={sendingCoInvites}
                  >
                    Back
                  </GhostButton>
                  <PrimaryButton
                    onClick={handleSendCoInvites}
                    disabled={sendingCoInvites}
                  >
                    {sendingCoInvites ? "Sending…" : "Next: Cosigner"}
                    {!sendingCoInvites && (
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    )}
                  </PrimaryButton>
                </div>
              </div>
            </Card>
          )}

          {wizardStep === "cosigners" && (
            <Card
              title="Will you use a cosigner?"
              titleIcon={<Users className="h-6 w-6 text-indigo-500" />}
            >
              <div className="space-y-4">
                <p className="text-sm text-gray-700">
                  A cosigner (or guarantor) is someone who agrees to back your lease financially,
                  often a parent or relative,
                </p>
                <p className="text-xs text-gray-500">
                  If your landlord requires one, invite them here so they can complete their part
                  digitally under the same household,
                </p>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-gray-700">
                    Cosigner email(s)
                  </label>
                  <p className="text-[11px] text-gray-500 mb-1">
                    You can leave this blank if you don’t need a cosigner yet, or add one or more
                    emails below,
                  </p>

                  {cosEmails.map((email, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => {
                          const next = [...cosEmails];
                          next[idx] = e.target.value;
                          setCosEmails(next);
                          if (cosError) setCosError(null);
                        }}
                        placeholder={idx === 0 ? "Primary cosigner email" : "Additional cosigner"}
                        className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      {idx === cosEmails.length - 1 && (
                        <GhostButton
                          onClick={() => setCosEmails([...cosEmails, ""])}
                          className="text-xs px-2 py-1"
                        >
                          +
                        </GhostButton>
                      )}
                    </div>
                  ))}
                </div>

                {cosError && (
                  <p className="mt-1 text-[11px] text-rose-600">{cosError}</p>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <GhostButton
                    onClick={() => setWizardStep("coApplicants")}
                    disabled={sendingCosInvites}
                  >
                    Back
                  </GhostButton>
                  <PrimaryButton
                    onClick={handleSendCosInvites}
                    disabled={sendingCosInvites}
                  >
                    {sendingCosInvites ? "Sending…" : "Finish setup"}
                    {!sendingCosInvites && (
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    )}
                  </PrimaryButton>
                </div>
              </div>
            </Card>
          )}

          {wizardStep === "done" && (
            <div
              className={clsx(
                "fixed inset-0 z-40 flex items-center justify-center bg-white text-slate-900",
                "h-[100dvh] overflow-hidden",
              )}
            >
              {/* soft success blob background */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative h-64 w-64 sm:h-80 sm:w-80">
                  <div className="absolute inset-0 rounded-[60%] bg-indigo-200/70 blur-3xl opacity-90" />
                  <div className="absolute -left-10 -top-8 h-40 w-40 rounded-[55%] bg-emerald-200/60 blur-3xl" />
                  <div className="absolute -right-8 bottom-0 h-44 w-44 rounded-[50%] bg-sky-200/65 blur-3xl" />
                </div>
              </div>

              {/* success text + actions */}
              <div className="relative z-10 w-full px-6">
                <div className="mx-auto max-w-md text-center">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                    {joinedFromInvite ? "Joined household" : "Household ready"}
                  </div>
                  <h2 className="text-2xl font-semibold text-slate-900">
                    {joinedFromInvite
                      ? joinedHouseholdName
                        ? `You’ve joined ${joinedHouseholdName},`
                        : "You’ve joined your household,"
                      : "Thank you for setting up your household,"}
                  </h2>
                  <p className="mt-3 text-sm text-slate-600">
                    {joinedFromInvite
                      ? "Your display name is saved and you’re linked to this household in MILO. You’re ready to move into applications and next steps,"
                      : "Your household name, display name, and invites are in place. You’re ready to move into applications and next steps inside MILO,"}
                  </p>

                  <div className="mt-6 flex flex-col items-stretch gap-3">
                    <PrimaryButton
                      onClick={() =>
                        window.location.replace("/tenant/household")
                      }
                    >
                      Go to your household
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </PrimaryButton>
                    <GhostButton
                      onClick={() => window.location.replace("/tenant")}
                    >
                      Go to tenant home
                    </GhostButton>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
