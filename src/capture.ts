/**
 * envsnap — capture module
 * Snapshots the current dev environment: runtimes, packages, env vars, git state, processes
 */

import { execSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir, platform, arch, release, totalmem, cpus } from "os";

export interface RuntimeVersion {
  name: string;
  version: string | null;
  path: string | null;
}

export interface GitState {
  branch: string | null;
  commit: string | null;
  dirty: boolean;
  untracked: number;
  stashCount: number;
  remoteUrl: string | null;
}

export interface PortProcess {
  port: number;
  pid: number | null;
  command: string | null;
}

export interface Snapshot {
  timestamp: string;
  hostname: string;
  platform: string;
  arch: string;
  osRelease: string;
  cpuCount: number;
  totalMemoryGB: number;
  cwd: string;
  runtimes: RuntimeVersion[];
  envVarNames: string[];
  envVarCount: number;
  git: GitState;
  portProcesses: PortProcess[];
  globalPackages: Record<string, string[]>;
  lockfileHash: string | null;
}

function run(cmd: string, fallback = ""): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return fallback;
  }
}

function captureRuntimes(): RuntimeVersion[] {
  const tools = [
    { name: "node", cmd: "node --version" },
    { name: "npm", cmd: "npm --version" },
    { name: "pnpm", cmd: "pnpm --version" },
    { name: "yarn", cmd: "yarn --version" },
    { name: "bun", cmd: "bun --version" },
    { name: "deno", cmd: "deno --version" },
    { name: "python", cmd: "python3 --version" },
    { name: "python2", cmd: "python2 --version" },
    { name: "go", cmd: "go version" },
    { name: "rust", cmd: "rustc --version" },
    { name: "cargo", cmd: "cargo --version" },
    { name: "java", cmd: "java -version 2>&1" },
    { name: "ruby", cmd: "ruby --version" },
    { name: "php", cmd: "php --version" },
    { name: "dotnet", cmd: "dotnet --version" },
    { name: "docker", cmd: "docker --version" },
    { name: "git", cmd: "git --version" },
  ];

  return tools.map((t) => {
    const output = run(t.cmd);
    const versionMatch = output.match(/(\d+\.[\d.]+)/);
    const whichPath = run(`which ${t.name} 2>/dev/null || where ${t.name} 2>/dev/null`);
    return {
      name: t.name,
      version: versionMatch ? versionMatch[1] : null,
      path: whichPath || null,
    };
  }).filter((r) => r.version !== null);
}

function captureGitState(): GitState {
  const isGitRepo = run("git rev-parse --is-inside-work-tree") === "true";
  if (!isGitRepo) {
    return { branch: null, commit: null, dirty: false, untracked: 0, stashCount: 0, remoteUrl: null };
  }

  const branch = run("git rev-parse --abbrev-ref HEAD");
  const commit = run("git rev-parse HEAD");
  const status = run("git status --porcelain");
  const dirty = status.length > 0;
  const untracked = status.split("\n").filter((l) => l.startsWith("??")).length;
  const stashCount = parseInt(run("git stash list", "0").split("\n").filter(Boolean).length.toString()) || 0;
  const remoteUrl = run("git config --get remote.origin.url") || null;

  return { branch, commit, dirty, untracked, stashCount, remoteUrl };
}

function capturePortProcesses(): PortProcess[] {
  const isMac = platform() === "darwin";
  const isLinux = platform() === "linux";

  const results: PortProcess[] = [];

  try {
    if (isMac || isLinux) {
      const output = run("lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null || ss -tlnp 2>/dev/null");
      const lines = output.split("\n").slice(1);
      const seen = new Set<number>();

      for (const line of lines) {
        const portMatch = line.match(/[.:](\d+)\s/);
        if (portMatch) {
          const port = parseInt(portMatch[1]);
          if (port > 0 && !seen.has(port)) {
            seen.add(port);
            const pidMatch = line.match(/(\d+)\s/);
            results.push({
              port,
              pid: pidMatch ? parseInt(pidMatch[1]) : null,
              command: line.split(/\s+/).pop() || null,
            });
          }
        }
      }
    }
  } catch {
    // Silently fail — port listing is best-effort
  }

  return results.sort((a, b) => a.port - b.port);
}

function captureGlobalPackages(): Record<string, string[]> {
  const pkg: Record<string, string[]> = {};

  const npmGlobals = run("npm list -g --depth=0 --json");
  try {
    const parsed = JSON.parse(npmGlobals);
    if (parsed.dependencies) {
      pkg["npm"] = Object.keys(parsed.dependencies);
    }
  } catch { /* ignore */ }

  const pipGlobals = run("pip3 list --format=json 2>/dev/null || pip list --format=json 2>/dev/null");
  try {
    const parsed = JSON.parse(pipGlobals);
    if (Array.isArray(parsed)) {
      pkg["pip"] = parsed.map((p: { name: string }) => p.name);
    }
  } catch { /* ignore */ }

  return pkg;
}

function captureLockfileHash(): string | null {
  const lockfiles = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "poetry.lock", "Cargo.lock", "go.sum"];
  for (const lf of lockfiles) {
    if (existsSync(lf)) {
      const hash = run(`shasum "${lf}" | cut -d' ' -f1`);
      return `${lf}:${hash}`;
    }
  }
  return null;
}

export function capture(cwd?: string): Snapshot {
  const originalDir = process.cwd();
  if (cwd) process.chdir(cwd);

  try {
    const envVarNames = Object.keys(process.env).sort();
    const mem = totalmem();
    const cpuList = cpus();

    return {
      timestamp: new Date().toISOString(),
      hostname: run("hostname"),
      platform: platform(),
      arch: arch(),
      osRelease: release(),
      cpuCount: cpuList.length,
      totalMemoryGB: Math.round((mem / 1073741824) * 100) / 100,
      cwd: process.cwd(),
      runtimes: captureRuntimes(),
      envVarNames: envVarNames,
      envVarCount: envVarNames.length,
      git: captureGitState(),
      portProcesses: capturePortProcesses(),
      globalPackages: captureGlobalPackages(),
      lockfileHash: captureLockfileHash(),
    };
  } finally {
    process.chdir(originalDir);
  }
}

export function saveSnapshot(snapshot: Snapshot, dir = ".envsnap"): string {
  const envsnapDir = join(process.cwd(), dir);
  mkdirSync(envsnapDir, { recursive: true });

  const filename = `snapshot-${snapshot.timestamp.replace(/[:.]/g, "-")}.json`;
  const filepath = join(envsnapDir, filename);
  writeFileSync(filepath, JSON.stringify(snapshot, null, 2));

  // Update "latest" pointer
  writeFileSync(join(envsnapDir, "latest.json"), JSON.stringify(snapshot, null, 2));

  return filepath;
}
