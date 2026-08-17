import type { HostStatus } from "../types.js";
import { HOST_MANIFEST } from "./host-manifest.generated.js";

export type HostVersionStatus = "match" | "mismatch" | "unknown";

export type CompatVerdict = {
  hostVersion: {
    pinned: string;
    live: string | null;
    status: HostVersionStatus;
  };
  capabilities: {
    known: string[];
    live: string[];
    missing: string[];
    extra: string[];
  };
  wrappers: {
    present: string[];
    missingFromTable: string[];
  };
};

export type CompatLiveStatus = Pick<HostStatus, "hostVersion" | "capabilities">;

export function evaluateCompat(
  live: CompatLiveStatus,
  manifest: typeof HOST_MANIFEST = HOST_MANIFEST,
): CompatVerdict {
  const pinned = manifest.hostVersion;
  const liveVersion =
    typeof live.hostVersion === "string" && live.hostVersion.length > 0
      ? live.hostVersion
      : null;
  const hostVersionStatus: HostVersionStatus =
    liveVersion == null ? "unknown" : liveVersion === pinned ? "match" : "mismatch";

  const known = [...manifest.capabilities] as string[];
  const liveCaps = Array.isArray(live.capabilities)
    ? live.capabilities.filter((name): name is string => typeof name === "string")
    : [];
  const knownSet = new Set<string>(known);
  const liveSet = new Set<string>(liveCaps);

  const commandTable = new Set<string>(manifest.commands);
  const wrapperNames = Object.keys(manifest.wrappers);
  const present = wrapperNames.filter((name) => commandTable.has(name));
  const missingFromTable = wrapperNames.filter((name) => !commandTable.has(name));

  return {
    hostVersion: {
      pinned,
      live: liveVersion,
      status: hostVersionStatus,
    },
    capabilities: {
      known,
      live: liveCaps,
      missing: known.filter((name) => !liveSet.has(name)),
      extra: liveCaps.filter((name) => !knownSet.has(name)),
    },
    wrappers: { present, missingFromTable },
  };
}

export function formatCompatVerdict(verdict: CompatVerdict): string {
  return `${JSON.stringify(verdict, null, 2)}\n`;
}
