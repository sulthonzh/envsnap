/**
 * envsnap — diff module
 * Compares two environment snapshots and highlights meaningful differences
 */

import { Snapshot } from "./capture";

export interface DiffEntry {
  category: string;
  field: string;
  before: string;
  after: string;
  severity: "info" | "warn" | "critical";
}

export interface DiffResult {
  entries: DiffEntry[];
  summary: {
    critical: number;
    warn: number;
    info: number;
    total: number;
  };
}

function runtimeMap(snapshot: Snapshot): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of snapshot.runtimes) {
    if (r.version) map.set(r.name, r.version);
  }
  return map;
}

function diffRuntimes(a: Snapshot, b: Snapshot): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const aMap = runtimeMap(a);
  const bMap = runtimeMap(b);

  // Check for version changes
  for (const [name, aVer] of aMap) {
    const bVer = bMap.get(name);
    if (!bVer) {
      entries.push({
        category: "Runtime",
        field: name,
        before: aVer,
        after: "(not installed)",
        severity: "warn",
      });
    } else if (aVer !== bVer) {
      entries.push({
        category: "Runtime",
        field: name,
        before: aVer,
        after: bVer,
        severity: "critical",
      });
    }
  }

  // New runtimes in B
  for (const [name, bVer] of bMap) {
    if (!aMap.has(name)) {
      entries.push({
        category: "Runtime",
        field: name,
        before: "(not installed)",
        after: bVer,
        severity: "warn",
      });
    }
  }

  return entries;
}

function diffEnvVars(a: Snapshot, b: Snapshot): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const aSet = new Set(a.envVarNames);
  const bSet = new Set(b.envVarNames);

  // Missing vars (in A but not B)
  for (const v of a.envVarNames) {
    if (!bSet.has(v)) {
      entries.push({
        category: "Env Variables",
        field: v,
        before: "present",
        after: "missing",
        severity: "warn",
      });
    }
  }

  // New vars (in B but not A)
  for (const v of b.envVarNames) {
    if (!aSet.has(v)) {
      entries.push({
        category: "Env Variables",
        field: v,
        before: "missing",
        after: "present",
        severity: "info",
      });
    }
  }

  return entries;
}

function diffGit(a: Snapshot, b: Snapshot): DiffEntry[] {
  const entries: DiffEntry[] = [];

  if (a.git.branch !== b.git.branch) {
    entries.push({
      category: "Git",
      field: "branch",
      before: a.git.branch || "(none)",
      after: b.git.branch || "(none)",
      severity: "warn",
    });
  }

  if (a.git.commit !== b.git.commit) {
    entries.push({
      category: "Git",
      field: "commit",
      before: (a.git.commit || "").slice(0, 8),
      after: (b.git.commit || "").slice(0, 8),
      severity: "info",
    });
  }

  if (a.git.dirty !== b.git.dirty) {
    entries.push({
      category: "Git",
      field: "dirty",
      before: String(a.git.dirty),
      after: String(b.git.dirty),
      severity: "warn",
    });
  }

  return entries;
}

function diffPorts(a: Snapshot, b: Snapshot): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const aPorts = new Map(a.portProcesses.map((p) => [p.port, p]));
  const bPorts = new Map(b.portProcesses.map((p) => [p.port, p]));

  for (const [port, proc] of aPorts) {
    if (!bPorts.has(port)) {
      entries.push({
        category: "Ports",
        field: `:${port}`,
        before: proc.command || "listening",
        after: "not listening",
        severity: "warn",
      });
    }
  }

  for (const [port, proc] of bPorts) {
    if (!aPorts.has(port)) {
      entries.push({
        category: "Ports",
        field: `:${port}`,
        before: "not listening",
        after: proc.command || "listening",
        severity: "info",
      });
    }
  }

  return entries;
}

function diffPlatform(a: Snapshot, b: Snapshot): DiffEntry[] {
  const entries: DiffEntry[] = [];

  const fields: Array<{ key: keyof Snapshot; label: string; severity: "critical" | "warn" | "info" }> = [
    { key: "platform", label: "OS", severity: "critical" },
    { key: "arch", label: "Architecture", severity: "critical" },
    { key: "osRelease", label: "OS Release", severity: "warn" },
    { key: "hostname", label: "Hostname", severity: "info" },
  ];

  for (const f of fields) {
    if (a[f.key] !== b[f.key]) {
      entries.push({
        category: "Platform",
        field: f.label,
        before: String(a[f.key]),
        after: String(b[f.key]),
        severity: f.severity,
      });
    }
  }

  return entries;
}

function diffLockfiles(a: Snapshot, b: Snapshot): DiffEntry[] {
  if (a.lockfileHash && b.lockfileHash && a.lockfileHash !== b.lockfileHash) {
    return [{
      category: "Dependencies",
      field: "lockfile",
      before: a.lockfileHash.split(":")[0],
      after: b.lockfileHash.split(":")[0],
      severity: "critical",
    }];
  }
  return [];
}

export function diffSnapshots(a: Snapshot, b: Snapshot): DiffResult {
  const entries = [
    ...diffPlatform(a, b),
    ...diffRuntimes(a, b),
    ...diffEnvVars(a, b),
    ...diffGit(a, b),
    ...diffPorts(a, b),
    ...diffLockfiles(a, b),
  ];

  return {
    entries,
    summary: {
      critical: entries.filter((e) => e.severity === "critical").length,
      warn: entries.filter((e) => e.severity === "warn").length,
      info: entries.filter((e) => e.severity === "info").length,
      total: entries.length,
    },
  };
}

export function formatDiff(result: DiffResult): string {
  if (result.entries.length === 0) {
    return "✅ Environments match — no differences found.";
  }

  const severityIcon = { critical: "🔴", warn: "🟡", info: "ℹ️" };
  const lines: string[] = [];

  lines.push(`Found ${result.summary.total} difference(s): ${result.summary.critical} critical, ${result.summary.warn} warnings, ${result.summary.info} info\n`);

  let currentCategory = "";
  for (const entry of result.entries) {
    if (entry.category !== currentCategory) {
      currentCategory = entry.category;
      lines.push(`\n${currentCategory}`);
      lines.push("─".repeat(40));
    }
    lines.push(`  ${severityIcon[entry.severity]} ${entry.field}: ${entry.before} → ${entry.after}`);
  }

  lines.push("");
  return lines.join("\n");
}
