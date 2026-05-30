#!/usr/bin/env node
/**
 * envsnap — CLI
 * Snapshot and diff your dev environment
 */

import { capture, saveSnapshot, Snapshot } from "./capture";
import { diffSnapshots, formatDiff } from "./diff";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";

const args = process.argv.slice(2);
const command = args[0];

function printUsage(): void {
  console.log(`
envsnap — dev environment snapshot & diff

Usage:
  envsnap capture [dir]        Snapshot current env (saves to .envsnap/)
  envsnap diff <file1> <file2> Compare two snapshots
  envsnap diff <file>          Compare snapshot against current env
  envsnap diff                 Compare latest snapshot against current env
  envsnap list                 List saved snapshots
  envsnap show [file]          Show snapshot details
  envsnap ci                   Capture CI-friendly minimal snapshot (no ports/processes)
  envsnap init                 Create .envsnap/ and add to .gitignore

Options:
  --json                       Output as JSON
  --quiet                      Minimal output
`);
}

function loadSnapshot(filepath: string): Snapshot {
  if (!existsSync(filepath)) {
    console.error(`❌ Snapshot not found: ${filepath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(filepath, "utf-8"));
}

function findLatestSnapshot(): string | null {
  const dir = ".envsnap";
  if (!existsSync(dir)) return null;

  const latestPath = join(dir, "latest.json");
  if (existsSync(latestPath)) return latestPath;

  const files = readdirSync(dir)
    .filter((f) => f.startsWith("snapshot-") && f.endsWith(".json"))
    .sort();

  return files.length > 0 ? join(dir, files[files.length - 1]) : null;
}

function isJson(): boolean {
  return args.includes("--json");
}

function handleCapture(): void {
  const targetDir = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  const snapshot = capture(targetDir);
  const path = saveSnapshot(snapshot);

  if (isJson()) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    console.log(`📸 Snapshot saved: ${path}`);
    console.log(`   Runtimes: ${snapshot.runtimes.length} | Env vars: ${snapshot.envVarCount} | Ports: ${snapshot.portProcesses.length}`);
    if (snapshot.git.branch) {
      console.log(`   Git: ${snapshot.git.branch} @ ${snapshot.git.commit?.slice(0, 8)}${snapshot.git.dirty ? " (dirty)" : ""}`);
    }
  }
}

function handleDiff(): void {
  const fileA = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  const fileB = args[2] && !args[2].startsWith("--") ? args[2] : undefined;

  let snapA: Snapshot;
  let snapB: Snapshot;

  if (fileA && fileB) {
    // Diff two files
    snapA = loadSnapshot(fileA);
    snapB = loadSnapshot(fileB);
  } else if (fileA) {
    // Diff file against current env
    snapA = loadSnapshot(fileA);
    snapB = capture();
  } else {
    // Diff latest snapshot against current env
    const latest = findLatestSnapshot();
    if (!latest) {
      console.error("❌ No snapshots found. Run `envsnap capture` first.");
      process.exit(1);
    }
    snapA = loadSnapshot(latest);
    snapB = capture();
    console.log(`Comparing against: ${latest}\n`);
  }

  const result = diffSnapshots(snapA, snapB);

  if (isJson()) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatDiff(result));
  }

  if (result.summary.critical > 0) {
    process.exit(2); // Exit code 2 for critical diffs (CI-friendly)
  }
}

function handleList(): void {
  const dir = ".envsnap";
  if (!existsSync(dir)) {
    console.log("No snapshots yet. Run `envsnap capture` to create one.");
    return;
  }

  const files = readdirSync(dir)
    .filter((f) => f.startsWith("snapshot-") && f.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    console.log("No snapshots found.");
    return;
  }

  if (isJson()) {
    console.log(JSON.stringify(files, null, 2));
    return;
  }

  console.log(`Found ${files.length} snapshot(s):\n`);
  for (const f of files) {
    const snap = loadSnapshot(join(dir, f));
    const time = snap.timestamp.replace("T", " ").slice(0, 19);
    const branch = snap.git.branch || "no git";
    console.log(`  ${f}`);
    console.log(`    ${time} | ${snap.platform}/${snap.arch} | ${branch} | ${snap.runtimes.length} runtimes`);
  }
}

function handleShow(): void {
  const file = args[1] && !args[1].startsWith("--") ? args[1] : findLatestSnapshot();

  if (!file) {
    console.error("❌ No snapshot specified and no snapshots found.");
    process.exit(1);
  }

  const snap = loadSnapshot(file);

  if (isJson()) {
    console.log(JSON.stringify(snap, null, 2));
    return;
  }

  console.log(`\n📋 Snapshot: ${file}`);
  console.log(`   Captured: ${snap.timestamp}`);
  console.log(`   Host: ${snap.hostname} (${snap.platform}/${snap.arch})`);
  console.log(`   OS: ${snap.osRelease}`);
  console.log(`   CPUs: ${snap.cpuCount} | RAM: ${snap.totalMemoryGB} GB`);
  console.log(`   CWD: ${snap.cwd}`);

  console.log(`\n🔧 Runtimes:`);
  for (const r of snap.runtimes) {
    console.log(`   ${r.name}: ${r.version}${r.path ? ` (${r.path})` : ""}`);
  }

  console.log(`\n🌐 Environment: ${snap.envVarCount} variables`);
  console.log(`📦 Lockfile: ${snap.lockfileHash || "none"}`);

  if (snap.git.branch) {
    console.log(`\n🔀 Git:`);
    console.log(`   Branch: ${snap.git.branch}`);
    console.log(`   Commit: ${snap.git.commit?.slice(0, 8)}${snap.git.dirty ? " (dirty)" : ""}`);
    console.log(`   Untracked: ${snap.git.untracked}`);
    console.log(`   Remote: ${snap.git.remoteUrl || "none"}`);
  }

  if (snap.portProcesses.length > 0) {
    console.log(`\n🔌 Listening Ports:`);
    for (const p of snap.portProcesses.slice(0, 20)) {
      console.log(`   :${p.port} — ${p.command || "unknown"}`);
    }
    if (snap.portProcesses.length > 20) {
      console.log(`   ... and ${snap.portProcesses.length - 20} more`);
    }
  }

  const pkgManagers = Object.keys(snap.globalPackages);
  if (pkgManagers.length > 0) {
    console.log(`\n📚 Global Packages:`);
    for (const pm of pkgManagers) {
      console.log(`   ${pm}: ${snap.globalPackages[pm].length} packages`);
    }
  }
  console.log("");
}

function handleCi(): void {
  // CI-friendly: minimal snapshot, no ports/processes (may need permissions)
  const snapshot = capture();
  const ciSnapshot = {
    ...snapshot,
    portProcesses: [],
    globalPackages: {},
  };

  const path = saveSnapshot(ciSnapshot);

  if (isJson()) {
    // Output only JSON to stdout for CI pipeline consumption
    console.log(JSON.stringify(ciSnapshot, null, 2));
  } else {
    console.log(JSON.stringify(ciSnapshot, null, 2));
    console.error(`📸 CI snapshot saved: ${path}`);
  }
}

function handleInit(): void {
  const dir = ".envsnap";
  if (!existsSync(dir)) {
    writeFileSync(join(dir, ".gitkeep"), "");
    console.log("Created .envsnap/");
  }

  // Add to .gitignore
  const gitignorePath = ".gitignore";
  let gitignore = "";
  if (existsSync(gitignorePath)) {
    gitignore = readFileSync(gitignorePath, "utf-8");
  }

  if (!gitignore.includes(".envsnap/")) {
    gitignore += (gitignore.endsWith("\n") ? "" : "\n") + "# Dev environment snapshots (share on demand)\n.envsnap/\n";
    writeFileSync(gitignorePath, gitignore);
    console.log("Added .envsnap/ to .gitignore");
  } else {
    console.log(".envsnap/ already in .gitignore");
  }

  console.log("\nDone! Run `envsnap capture` to take your first snapshot.");
}

// Main
switch (command) {
  case "capture":
    handleCapture();
    break;
  case "diff":
    handleDiff();
    break;
  case "list":
    handleList();
    break;
  case "show":
    handleShow();
    break;
  case "ci":
    handleCi();
    break;
  case "init":
    handleInit();
    break;
  default:
    printUsage();
    break;
}
