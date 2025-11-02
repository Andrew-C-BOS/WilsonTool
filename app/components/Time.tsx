"use client";

import * as React from "react";

type LocalTimeProps = {
  iso?: string | number | Date | null;
  tz?: string; // e.g., "America/New_York"
  format?: "date" | "time" | "dateTime" | "short"; // default: "dateTime"
  includeZone?: boolean; // default: true for dateTime/time, false for date
  className?: string;
  titlePrefix?: string; // optional hover prefix
};

function toDate(iso?: string | number | Date | null): Date | null {
  if (!iso) return null;
  try {
    const d = iso instanceof Date ? iso : new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export default function LocalTime({
  iso,
  tz,
  format = "dateTime",
  includeZone,
  className,
  titlePrefix,
}: LocalTimeProps) {
  const d = toDate(iso);
  if (!d) return <span className={className}>—</span>;

  // Prefer explicit tz, fall back to the viewer's browser timezone
  let timeZone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Pick sensible defaults
  const showZone =
    typeof includeZone === "boolean"
      ? includeZone
      : format === "date" ? false : true;

  const optsBase: Intl.DateTimeFormatOptions = { timeZone, hour12: true };
  let opts: Intl.DateTimeFormatOptions;

  switch (format) {
    case "date":
      opts = { ...optsBase, year: "numeric", month: "short", day: "2-digit" };
      break;
    case "time":
      opts = { ...optsBase, hour: "numeric", minute: "2-digit" };
      break;
    case "short":
      opts = { ...optsBase, year: "2-digit", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" };
      break;
    default:
      opts = { ...optsBase, year: "numeric", month: "short", day: "2-digit", hour: "numeric", minute: "2-digit" };
      break;
  }

  if (showZone) {
    opts.timeZoneName = "short";
  }

  const text = new Intl.DateTimeFormat(undefined, opts).format(d);
  const title = `${titlePrefix ? `${titlePrefix} ` : ""}${d.toISOString()}`;

  return (
    <time dateTime={d.toISOString()} title={title} className={className}>
      {text}
    </time>
  );
}

