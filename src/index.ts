#!/usr/bin/env node

import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import type { Sandbox as SandboxInstance, SecretEntry } from "microsandbox"
import {
	install,
	isInstalled,
	Mount,
	NetworkPolicy,
	Sandbox,
	Secret,
} from "microsandbox"

export const SANDBOX_NAME = "pi-coding-agent"
export const SANDBOX_IMAGE = "node:24-slim"
export const GUEST_WORKDIR = "/workspace"

export function termEnv(
	env: Record<string, string | undefined> = process.env,
): Record<string, string> {
	const vars: Record<string, string | undefined> = {
		TERM: env.TERM ?? "xterm-256color",
		COLORTERM: env.COLORTERM,
		TERM_PROGRAM: env.TERM_PROGRAM,
		TERM_PROGRAM_VERSION: env.TERM_PROGRAM_VERSION,
		LANG: env.LANG,
		LC_ALL: env.LC_ALL,
	}
	const result: Record<string, string> = {}
	for (const [k, v] of Object.entries(vars)) {
		if (v) result[k] = v
	}
	return result
}

export function buildSecrets(
	env: Record<string, string | undefined>,
): SecretEntry[] {
	const secrets: SecretEntry[] = []
	if (env.ANTHROPIC_API_KEY) {
		secrets.push(
			Secret.env("ANTHROPIC_API_KEY", {
				value: env.ANTHROPIC_API_KEY,
				allowHosts: ["api.anthropic.com"],
			}),
		)
	}
	if (env.ZAI_API_KEY) {
		secrets.push(
			Secret.env("ZAI_API_KEY", {
				value: env.ZAI_API_KEY,
				allowHosts: ["api.z.ai", "open.bigmodel.cn"],
			}),
		)
	}
	if (env.MINIMAX_API_KEY) {
		secrets.push(
			Secret.env("MINIMAX_API_KEY", {
				value: env.MINIMAX_API_KEY,
				allowHosts: ["api.minimax.io", "api.minimax.chat"],
			}),
		)
	}
	return secrets
}

export interface GetOrCreateResult {
	sb: SandboxInstance
	reused: boolean
}

export async function getOrCreateSandbox(
	name: string,
	image: string,
	projectDir: string,
	secrets: SecretEntry[],
): Promise<GetOrCreateResult> {
	try {
		const handle = await Sandbox.get(name)
		if (handle.status === "running") {
			return { sb: await handle.connect(), reused: true }
		}
		return { sb: await handle.start(), reused: true }
	} catch {
		const sb = await Sandbox.create({
			name,
			image,
			cpus: 2,
			memoryMib: 2048,
			workdir: GUEST_WORKDIR,
			volumes: { [GUEST_WORKDIR]: Mount.bind(projectDir) },
			secrets,
			network: NetworkPolicy.allowAll(),
			env: termEnv(),
			quietLogs: true,
		})
		return { sb, reused: false }
	}
}

async function main(): Promise<void> {
	const projectDir = resolve(process.argv[2] || process.cwd())

	if (!existsSync(projectDir)) {
		console.error(`Project directory not found: ${projectDir}`)
		process.exit(1)
	}

	if (!isInstalled()) {
		console.error("Installing microsandbox runtime...")
		await install()
	}

	const apiKey = process.env.ANTHROPIC_API_KEY
	const zaiApiKey = process.env.ZAI_API_KEY
	const minimaxApiKey = process.env.MINIMAX_API_KEY

	if (!apiKey && !zaiApiKey && !minimaxApiKey) {
		console.error(
			"At least one API key required: ANTHROPIC_API_KEY, ZAI_API_KEY, or MINIMAX_API_KEY.",
		)
		process.exit(1)
	}

	const secrets = buildSecrets(process.env)

	const { sb, reused } = await getOrCreateSandbox(
		SANDBOX_NAME,
		SANDBOX_IMAGE,
		projectDir,
		secrets,
	)

	if (reused) {
		console.error(`Reusing existing sandbox "${SANDBOX_NAME}"...`)
	}

	try {
		// Install pi coding agent (only on fresh sandbox)
		if (!reused) {
			console.error("Installing pi coding agent...")
			const installResult = await sb.exec("npm", [
				"install",
				"-g",
				"@mariozechner/pi-coding-agent",
			])
			if (!installResult.success) {
				console.error("Failed to install pi:")
				console.error(installResult.stderr())
				await sb.kill()
				process.exit(1)
			}
		}

		// Hand over terminal to pi — user interacts directly
		console.error("Starting pi coding agent (Ctrl+] to detach)...\n")
		const exitCode = await sb.attachWithConfig({
			cmd: "pi",
			cwd: GUEST_WORKDIR,
			env: termEnv(),
		})

		process.exit(exitCode)
	} catch (err) {
		console.error("Error:", err)
		await sb.kill()
		process.exit(1)
	} finally {
		// Best-effort cleanup
		try {
			await sb.stop()
		} catch {
			// already stopped or killed
		}
	}
}

const isMain =
	process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.path)
if (isMain) {
	main().catch((err) => {
		console.error("Fatal:", err)
		process.exit(1)
	})
}
