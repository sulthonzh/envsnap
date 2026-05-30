/**
 * envsnap — tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffSnapshots, formatDiff } from "../diff";
import { Snapshot } from "../capture";

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    timestamp: "2026-05-30T00:00:00.000Z",
    hostname: "test-host",
    platform: "darwin",
    arch: "arm64",
    osRelease: "25.3.0",
    cpuCount: 8,
    totalMemoryGB: 16,
    cwd: "/tmp/test",
    runtimes: [
      { name: "node", version: "20.11.0", path: "/usr/local/bin/node" },
      { name: "npm", version: "10.2.4", path: "/usr/local/bin/npm" },
    ],
    envVarNames: ["HOME", "PATH", "NODE_ENV"],
    envVarCount: 3,
    git: {
      branch: "main",
      commit: "abc1234567890",
      dirty: false,
      untracked: 0,
      stashCount: 0,
      remoteUrl: "https://github.com/test/repo.git",
    },
    portProcesses: [
      { port: 3000, pid: 1234, command: "node" },
      { port: 5432, pid: 5678, command: "postgres" },
    ],
    globalPackages: { npm: ["typescript", "pnpm"] },
    lockfileHash: "package-lock.json:abc123",
    ...overrides,
  };
}

describe("diffSnapshots", () => {
  it("returns empty diff for identical snapshots", () => {
    const snap = makeSnapshot();
    const result = diffSnapshots(snap, snap);
    assert.equal(result.summary.total, 0);
  });

  it("detects runtime version change", () => {
    const a = makeSnapshot();
    const b = makeSnapshot({
      runtimes: [
        { name: "node", version: "22.0.0", path: "/usr/local/bin/node" },
        { name: "npm", version: "10.2.4", path: "/usr/local/bin/npm" },
      ],
    });
    const result = diffSnapshots(a, b);
    assert.ok(result.entries.some((e: any) => e.field === "node" && e.severity === "critical"));
  });

  it("detects missing runtime", () => {
    const a = makeSnapshot();
    const b = makeSnapshot({ runtimes: [{ name: "node", version: "20.11.0", path: "/usr/local/bin/node" }] });
    const result = diffSnapshots(a, b);
    assert.ok(result.entries.some((e: any) => e.field === "npm" && e.after === "(not installed)"));
  });

  it("detects new runtime", () => {
    const a = makeSnapshot();
    const b = makeSnapshot({
      runtimes: [
        ...a.runtimes,
        { name: "go", version: "1.22.0", path: "/usr/local/bin/go" },
      ],
    });
    const result = diffSnapshots(a, b);
    assert.ok(result.entries.some((e: any) => e.field === "go" && e.before === "(not installed)"));
  });

  it("detects missing env vars", () => {
    const a = makeSnapshot();
    const b = makeSnapshot({ envVarNames: ["HOME", "PATH"] });
    const result = diffSnapshots(a, b);
    assert.ok(result.entries.some((e: any) => e.field === "NODE_ENV" && e.after === "missing"));
  });

  it("detects new env vars", () => {
    const a = makeSnapshot();
    const b = makeSnapshot({ envVarNames: ["HOME", "PATH", "NODE_ENV", "NEW_VAR"] });
    const result = diffSnapshots(a, b);
    assert.ok(result.entries.some((e: any) => e.field === "NEW_VAR" && e.before === "missing"));
  });

  it("detects branch change", () => {
    const a = makeSnapshot();
    const b = makeSnapshot({ git: { ...a.git, branch: "develop" } });
    const result = diffSnapshots(a, b);
    assert.ok(result.entries.some((e: any) => e.field === "branch" && e.category === "Git"));
  });

  it("detects platform change as critical", () => {
    const a = makeSnapshot();
    const b = makeSnapshot({ platform: "linux" });
    const result = diffSnapshots(a, b);
    assert.ok(result.entries.some((e: any) => e.field === "OS" && e.severity === "critical"));
  });

  it("detects port differences", () => {
    const a = makeSnapshot();
    const b = makeSnapshot({ portProcesses: [{ port: 3000, pid: 1234, command: "node" }] });
    const result = diffSnapshots(a, b);
    assert.ok(result.entries.some((e: any) => e.field === ":5432" && e.category === "Ports"));
  });

  it("detects lockfile hash change", () => {
    const a = makeSnapshot();
    const b = makeSnapshot({ lockfileHash: "package-lock.json:def456" });
    const result = diffSnapshots(a, b);
    assert.ok(result.entries.some((e: any) => e.field === "lockfile" && e.severity === "critical"));
  });

  it("counts severities correctly", () => {
    const a = makeSnapshot();
    const b = makeSnapshot({
      platform: "linux",
      arch: "x64",
      runtimes: [{ name: "node", version: "99.0.0", path: "/usr/bin/node" }],
      envVarNames: ["HOME", "PATH", "NODE_ENV", "EXTRA"],
    });
    const result = diffSnapshots(a, b);
    assert.equal(
      result.summary.critical + result.summary.warn + result.summary.info,
      result.summary.total
    );
  });
});

describe("formatDiff", () => {
  it("shows match message for empty diff", () => {
    const result = diffSnapshots(makeSnapshot(), makeSnapshot());
    const output = formatDiff(result);
    assert.ok(output.includes("match"));
  });

  it("includes entries in formatted output", () => {
    const a = makeSnapshot();
    const b = makeSnapshot({ platform: "linux", runtimes: [{ name: "node", version: "99.0.0", path: "/usr/bin/node" }] });
    const result = diffSnapshots(a, b);
    const output = formatDiff(result);
    assert.ok(output.includes("OS"));
    assert.ok(output.includes("node"));
  });
});
