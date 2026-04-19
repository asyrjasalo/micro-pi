import { beforeEach, describe, expect, it, mock } from "bun:test"
import { buildSecrets, termEnv } from "../src/index.ts"

describe("termEnv", () => {
	it("returns TERM with xterm-256color fallback when not set", () => {
		const env = termEnv({})
		expect(env.TERM).toBe("xterm-256color")
	})

	it("uses provided TERM value", () => {
		const env = termEnv({ TERM: "xterm" })
		expect(env.TERM).toBe("xterm")
	})

	it("includes COLORTERM when set", () => {
		const env = termEnv({ TERM: "xterm", COLORTERM: "truecolor" })
		expect(env.COLORTERM).toBe("truecolor")
	})

	it("omits COLORTERM when undefined", () => {
		const env = termEnv({ TERM: "xterm" })
		expect("COLORTERM" in env).toBe(false)
	})

	it("includes TERM_PROGRAM when set", () => {
		const env = termEnv({ TERM: "xterm", TERM_PROGRAM: "iTerm.app" })
		expect(env.TERM_PROGRAM).toBe("iTerm.app")
	})

	it("includes TERM_PROGRAM_VERSION when set", () => {
		const env = termEnv({ TERM: "xterm", TERM_PROGRAM_VERSION: "3.4.0" })
		expect(env.TERM_PROGRAM_VERSION).toBe("3.4.0")
	})

	it("includes LANG when set", () => {
		const env = termEnv({ TERM: "xterm", LANG: "en_US.UTF-8" })
		expect(env.LANG).toBe("en_US.UTF-8")
	})

	it("includes LC_ALL when set", () => {
		const env = termEnv({ TERM: "xterm", LC_ALL: "C" })
		expect(env.LC_ALL).toBe("C")
	})

	it("returns only defined values", () => {
		const env = termEnv({ TERM: "xterm-256color", COLORTERM: "truecolor" })
		for (const v of Object.values(env)) {
			expect(v).toBeDefined()
		}
	})
})

describe("buildSecrets", () => {
	it("returns empty array when no keys set", () => {
		expect(buildSecrets({})).toHaveLength(0)
	})

	it("builds ANTHROPIC_API_KEY secret", () => {
		const secrets = buildSecrets({ ANTHROPIC_API_KEY: "sk-test" })
		expect(secrets).toHaveLength(1)
		expect(secrets[0].envVar).toBe("ANTHROPIC_API_KEY")
		expect(secrets[0].value).toBe("sk-test")
		expect(secrets[0].allowHosts).toEqual(["api.anthropic.com"])
	})

	it("builds ZAI_API_KEY secret", () => {
		const secrets = buildSecrets({ ZAI_API_KEY: "zai-test" })
		expect(secrets).toHaveLength(1)
		expect(secrets[0].envVar).toBe("ZAI_API_KEY")
		expect(secrets[0].allowHosts).toEqual(["api.z.ai", "open.bigmodel.cn"])
	})

	it("builds MINIMAX_API_KEY secret", () => {
		const secrets = buildSecrets({ MINIMAX_API_KEY: "mm-test" })
		expect(secrets).toHaveLength(1)
		expect(secrets[0].envVar).toBe("MINIMAX_API_KEY")
		expect(secrets[0].allowHosts).toEqual([
			"api.minimax.io",
			"api.minimax.chat",
		])
	})

	it("builds all three secrets when all keys present", () => {
		const secrets = buildSecrets({
			ANTHROPIC_API_KEY: "sk-test",
			ZAI_API_KEY: "zai-test",
			MINIMAX_API_KEY: "mm-test",
		})
		expect(secrets).toHaveLength(3)
	})

	it("ignores undefined keys", () => {
		const secrets = buildSecrets({
			ANTHROPIC_API_KEY: "sk-test",
			ZAI_API_KEY: undefined,
		})
		expect(secrets).toHaveLength(1)
	})
})

describe("getOrCreateSandbox", () => {
	const fakeSandbox = {
		exec: mock(() => Promise.resolve({ success: true, stderr: () => "" })),
		attachWithConfig: mock(() => Promise.resolve(0)),
		kill: mock(() => Promise.resolve()),
		stop: mock(() => Promise.resolve()),
	}

	const connectFn = mock(() => Promise.resolve(fakeSandbox))
	const startFn = mock(() => Promise.resolve(fakeSandbox))
	const createFn = mock(() => Promise.resolve(fakeSandbox))

	beforeEach(() => {
		connectFn.mockClear()
		startFn.mockClear()
		createFn.mockClear()
	})

	it("connects to running sandbox", async () => {
		const getFn = mock(() =>
			Promise.resolve({
				status: "running",
				connect: connectFn,
				start: startFn,
			}),
		)

		mock.module("microsandbox", () => ({
			Sandbox: { get: getFn, create: createFn },
			Secret: {
				env: (k: string, v: Record<string, string>) => ({ envVar: k, ...v }),
			},
			NetworkPolicy: { allowAll: () => ({}) },
			Mount: { bind: (p: string) => p },
		}))

		const { getOrCreateSandbox, SANDBOX_NAME, SANDBOX_IMAGE } = await import(
			"../src/index.ts?t=connect"
		)
		const result = await getOrCreateSandbox(
			SANDBOX_NAME,
			SANDBOX_IMAGE,
			"/tmp",
			[],
		)

		expect(result.reused).toBe(true)
		expect(connectFn).toHaveBeenCalled()
		expect(startFn).not.toHaveBeenCalled()
	})

	it("starts stopped sandbox", async () => {
		const getFn = mock(() =>
			Promise.resolve({
				status: "stopped",
				connect: connectFn,
				start: startFn,
			}),
		)

		mock.module("microsandbox", () => ({
			Sandbox: { get: getFn, create: createFn },
			Secret: {
				env: (k: string, v: Record<string, string>) => ({ envVar: k, ...v }),
			},
			NetworkPolicy: { allowAll: () => ({}) },
			Mount: { bind: (p: string) => p },
		}))

		const { getOrCreateSandbox, SANDBOX_NAME, SANDBOX_IMAGE } = await import(
			"../src/index.ts?t=start"
		)
		const result = await getOrCreateSandbox(
			SANDBOX_NAME,
			SANDBOX_IMAGE,
			"/tmp",
			[],
		)

		expect(result.reused).toBe(true)
		expect(startFn).toHaveBeenCalled()
		expect(connectFn).not.toHaveBeenCalled()
	})

	it("creates new sandbox when get throws", async () => {
		const getFn = mock(() => Promise.reject(new Error("not found")))

		mock.module("microsandbox", () => ({
			Sandbox: { get: getFn, create: createFn },
			Secret: {
				env: (k: string, v: Record<string, string>) => ({ envVar: k, ...v }),
			},
			NetworkPolicy: { allowAll: () => ({}) },
			Mount: { bind: (p: string) => p },
		}))

		const { getOrCreateSandbox, SANDBOX_NAME, SANDBOX_IMAGE } = await import(
			"../src/index.ts?t=create"
		)
		const result = await getOrCreateSandbox(
			SANDBOX_NAME,
			SANDBOX_IMAGE,
			"/tmp",
			[],
		)

		expect(result.reused).toBe(false)
		expect(createFn).toHaveBeenCalled()
	})
})
