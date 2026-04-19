#!/usr/bin/env node

import { existsSync, readdirSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type {
  PatchConfig,
  Sandbox as SandboxInstance,
  SecretEntry,
} from "microsandbox"
import {
  install,
  isInstalled,
  Mount,
  NetworkPolicy,
  Patch,
  Sandbox,
} from "microsandbox"

export const SANDBOX_NAME = "pi-coding-agent"
export const SANDBOX_IMAGE = "node:24-slim"
export const GUEST_WORKDIR = "/workspace"
export const GUEST_HOME = "/"
export const PI_AGENT_REL = ".pi/agent"

export const PI_EXCLUDE = new Set(["sessions", "git", "mcp-cache.json"])

export function asciiOnly(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "?")
}

export function termEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const vars: Record<string, string | undefined> = {
    TERM: env.TERM ?? "xterm-256color",
    COLORTERM: env.COLORTERM,
    TERM_PROGRAM: env.TERM_PROGRAM,
    TERM_PROGRAM_VERSION: env.TERM_PROGRAM_VERSION,
    NO_COLOR: env.NO_COLOR,
    FORCE_COLOR: env.FORCE_COLOR,
    LANG: env.LANG,
    LC_ALL: env.LC_ALL,
    EMAIL: env.EMAIL,
    GIT_AUTHOR_NAME: env.GIT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: env.GIT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: env.GIT_COMMITTER_NAME,
    GIT_COMMITTER_EMAIL: env.GIT_COMMITTER_EMAIL,
    PI_RUN_CODE_UNSANDBOXED: "1",
  }
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) {
    if (v) result[k] = asciiOnly(v)
  }
  return result
}

export function buildSecrets(
  _env: Record<string, string | undefined>,
): SecretEntry[] {
  return []
}

export function apiEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const result: Record<string, string> = {}
  if (env.ZAI_API_KEY) result.ZAI_API_KEY = env.ZAI_API_KEY
  if (env.MINIMAX_API_KEY) result.MINIMAX_API_KEY = env.MINIMAX_API_KEY
  return result
}

export const PI_ROOT_EXCLUDE = new Set(["agent"])

export function buildPiPatches(hostHome: string = homedir()): PatchConfig[] {
  const piRoot = join(hostHome, ".pi")
  if (!existsSync(piRoot)) return []

  const guestPiRoot = join(GUEST_HOME, ".pi")
  const guestAgentDir = join(guestPiRoot, "agent")
  const patches: PatchConfig[] = [Patch.mkdir(guestPiRoot)]

  // Copy root-level ~/.pi/ files (e.g. web-search.json), skip dirs like agent/
  const piDir = join(piRoot, "agent")
  if (existsSync(piDir)) {
    patches.push(Patch.mkdir(guestAgentDir))
    for (const entry of readdirSync(piDir, { withFileTypes: true })) {
      if (PI_EXCLUDE.has(entry.name)) continue
      const realPath = realpathSync(join(piDir, entry.name))
      const guestPath = join(guestAgentDir, entry.name)
      if (statSync(realPath).isDirectory()) {
        patches.push(Patch.copyDir(realPath, guestPath))
      } else {
        patches.push(Patch.copyFile(realPath, guestPath))
      }
    }
  }

  for (const entry of readdirSync(piRoot, { withFileTypes: true })) {
    if (PI_ROOT_EXCLUDE.has(entry.name)) continue
    if (!entry.isFile() && !entry.isSymbolicLink()) continue
    const realPath = realpathSync(join(piRoot, entry.name))
    const guestPath = join(guestPiRoot, entry.name)
    patches.push(Patch.copyFile(realPath, guestPath))
  }

  return patches
}

export interface GetOrCreateResult {
  sb: SandboxInstance
  reused: boolean
}

async function tryConnectExisting(
  name: string,
): Promise<GetOrCreateResult | null> {
  try {
    const handle = await Sandbox.get(name)
    if (handle.status === "stopped") {
      await handle.start()
    }
    return { sb: await handle.connect(), reused: true }
  } catch {
    return null
  }
}

export async function getOrCreateSandbox(
  name: string,
  image: string,
  projectDir: string,
  secrets: SecretEntry[],
  patches: PatchConfig[] = [],
  env: Record<string, string> = {},
): Promise<GetOrCreateResult> {
  const existing = await tryConnectExisting(name)
  if (existing) return existing

  try {
    const sb = await Sandbox.create({
      name,
      image,
      cpus: 2,
      memoryMib: 2048,
      workdir: GUEST_WORKDIR,
      volumes: { [GUEST_WORKDIR]: Mount.bind(projectDir) },
      secrets,
      patches,
      network: NetworkPolicy.allowAll(),
      env,
      quietLogs: true,
    })
    return { sb, reused: false }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("already exists")) {
      const handle = await Sandbox.get(name)
      if (handle.status === "stopped") {
        await handle.start()
      }
      return { sb: await handle.connect(), reused: true }
    }
    throw e
  }
}

async function main(): Promise<void> {
  const projectDir = resolve(process.argv[2] || process.cwd())

  if (!existsSync(projectDir)) {
    console.error(`Project directory not found: ${projectDir}`)
    process.exit(1)
  }

  if (!isInstalled()) {
    console.info("Installing microsandbox runtime...")
    await install()
  }

  const zaiApiKey = process.env.ZAI_API_KEY
  const minimaxApiKey = process.env.MINIMAX_API_KEY

  if (!zaiApiKey && !minimaxApiKey) {
    console.error(
      "At least one API key required: ZAI_API_KEY or MINIMAX_API_KEY.",
    )
    process.exit(1)
  }

  const secrets = buildSecrets(process.env)
  const patches = buildPiPatches()
  const envVars = { ...termEnv(), ...apiEnv() }

  const { sb, reused } = await getOrCreateSandbox(
    SANDBOX_NAME,
    SANDBOX_IMAGE,
    projectDir,
    secrets,
    patches,
    envVars,
  )

  if (reused) {
    console.info(`Reusing existing sandbox "${SANDBOX_NAME}"...`)
  }

  try {
    if (!reused) {
      console.info("Creating fresh sandbox...")
      console.info("Upgrading glibc from trixie...")
      const glibcResult = await sb.shell(
        "echo 'deb http://deb.debian.org/debian trixie main' > /etc/apt/sources.list.d/trixie.list && apt-get update -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/trixie.list -o Dir::Etc::sourceparts=/dev/null && apt-get install -y -t trixie libc6",
      )
      if (!glibcResult.success) {
        console.error("Failed to upgrade glibc:")
        console.error(glibcResult.stderr())
        await sb.kill()
        process.exit(1)
      }

      console.info("Installing packages...")
      const setupResult = await sb.shell(
        "apt-get update && apt-get install -y git ca-certificates curl fd-find ripgrep locales && mkdir -p /.pi/agent/bin && ln -sf /usr/bin/fdfind /.pi/agent/bin/fd && sed -i 's/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen && locale-gen en_US.UTF-8 && update-locale LANG=en_US.UTF-8",
      )
      if (!setupResult.success) {
        console.error("Failed to install packages:")
        console.error(setupResult.stderr())
        await sb.kill()
        process.exit(1)
      }

      console.info("Installing rtk...")
      const rtkResult = await sb.shell(
        "curl -fsSL --max-time 120 https://github.com/rtk-ai/rtk/releases/latest/download/rtk-aarch64-unknown-linux-gnu.tar.gz -o /tmp/rtk.tar.gz && tar xzf /tmp/rtk.tar.gz -C /usr/local/bin && rm /tmp/rtk.tar.gz",
      )
      if (!rtkResult.success) {
        console.error("Failed to install rtk:")
        console.error(rtkResult.stderr())
      }

      console.info("Installing Pi Coding Agent...")
      const installResult = await sb.exec("npm", [
        "install",
        "-g",
        "@mariozechner/pi-coding-agent",
      ])
      console.info(installResult.stderr())
      if (!installResult.success) {
        console.error("Failed to install pi:")
        console.error(installResult.stderr())
        await sb.kill()
        process.exit(1)
      }
    }

    console.info("Starting Pi Coding Agent...\n")
    const exitCode = await sb.attachWithConfig({
      cmd: "pi",
      cwd: GUEST_WORKDIR,
      env: envVars,
    })

    try {
      await sb.stop()
    } catch {
      // sandbox may already be stopped
    }

    process.exit(exitCode)
  } catch (err) {
    console.error("Error:", err)
    try {
      await sb.stop()
    } catch {
      // not lifecycle owner
    }
    process.exit(1)
  }
}

const entryPath = process.argv[1] && resolve(process.argv[1])
const thisPath = resolve(fileURLToPath(import.meta.url))
const isMain = entryPath === thisPath
if (isMain) {
  main().catch((err) => {
    console.error("Fatal:", err)
    process.exit(1)
  })
}
