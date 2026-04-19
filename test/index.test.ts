import { beforeEach, describe, expect, it, mock } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apiEnv, buildPiPatches, buildSecrets, termEnv } from "../src/index.ts"

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
  it("returns empty array", () => {
    expect(buildSecrets({ ZAI_API_KEY: "test" })).toHaveLength(0)
  })
})

describe("apiEnv", () => {
  it("returns empty object when no keys set", () => {
    expect(Object.keys(apiEnv({}))).toHaveLength(0)
  })

  it("includes ZAI_API_KEY when set", () => {
    const env = apiEnv({ ZAI_API_KEY: "zai-test" })
    expect(env.ZAI_API_KEY).toBe("zai-test")
  })

  it("includes MINIMAX_API_KEY when set", () => {
    const env = apiEnv({ MINIMAX_API_KEY: "mm-test" })
    expect(env.MINIMAX_API_KEY).toBe("mm-test")
  })

  it("includes both keys when both set", () => {
    const env = apiEnv({
      ZAI_API_KEY: "zai-test",
      MINIMAX_API_KEY: "mm-test",
    })
    expect(env.ZAI_API_KEY).toBe("zai-test")
    expect(env.MINIMAX_API_KEY).toBe("mm-test")
  })

  it("ignores undefined keys", () => {
    const env = apiEnv({ ZAI_API_KEY: "zai-test", MINIMAX_API_KEY: undefined })
    expect(env.ZAI_API_KEY).toBe("zai-test")
    expect("MINIMAX_API_KEY" in env).toBe(false)
  })
})

describe("buildPiPatches", () => {
  it("returns empty array when ~/.pi/agent does not exist", () => {
    expect(buildPiPatches("/nonexistent-path")).toHaveLength(0)
  })

  it("creates guest .pi and .pi/agent dirs", () => {
    const tmp = mkdtempSync(join(tmpdir(), "msbox-test-"))
    mkdirSync(join(tmp, ".pi/agent"), { recursive: true })
    writeFileSync(join(tmp, ".pi/agent/settings.json"), "{}")
    const patches = buildPiPatches(tmp)
    expect(patches[0].kind).toBe("mkdir")
    expect(patches[0].path).toContain(".pi")
    expect(patches[1].kind).toBe("mkdir")
    expect(patches[1].path).toContain("agent")
  })

  it("dereferences symlinks", () => {
    const tmp = mkdtempSync(join(tmpdir(), "msbox-test-"))
    mkdirSync(join(tmp, ".pi/agent"), { recursive: true })
    mkdirSync(join(tmp, "real-config"), { recursive: true })
    writeFileSync(join(tmp, "real-config/settings.json"), '{"key": true}')
    symlinkSync(
      join(tmp, "real-config/settings.json"),
      join(tmp, ".pi/agent/settings.json"),
    )
    const patches = buildPiPatches(tmp)
    const copy = patches.find((p) => p.dst?.includes("settings.json"))
    expect(copy).toBeDefined()
    expect(copy?.src).toBe(realpathSync(join(tmp, "real-config/settings.json")))
  })

  it("copies directories", () => {
    const tmp = mkdtempSync(join(tmpdir(), "msbox-test-"))
    mkdirSync(join(tmp, ".pi/agent/skills/my-skill"), { recursive: true })
    writeFileSync(
      join(tmp, ".pi/agent/skills/my-skill/instructions.md"),
      "do stuff",
    )
    const patches = buildPiPatches(tmp)
    const dirPatch = patches.find((p) => p.dst?.includes("skills"))
    expect(dirPatch).toBeDefined()
    expect(dirPatch?.kind).toBe("copyDir")
  })

  it("excludes OS-specific entries", () => {
    const tmp = mkdtempSync(join(tmpdir(), "msbox-test-"))
    mkdirSync(join(tmp, ".pi/agent/sessions"), { recursive: true })
    mkdirSync(join(tmp, ".pi/agent/git"), { recursive: true })
    writeFileSync(join(tmp, ".pi/agent/mcp-cache.json"), "{}")
    writeFileSync(join(tmp, ".pi/agent/settings.json"), "{}")
    const patches = buildPiPatches(tmp)
    const dsts = patches.map((p) => p.dst).filter(Boolean)
    for (const excluded of ["sessions", "git", "mcp-cache.json"]) {
      expect(dsts.some((d) => d?.includes(excluded))).toBe(false)
    }
    expect(dsts.some((d) => d?.includes("settings.json"))).toBe(true)
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
  const handleStartFn = mock(() => Promise.resolve())
  const startFn = mock(() => Promise.resolve(fakeSandbox))
  const createFn = mock(() => Promise.resolve(fakeSandbox))

  beforeEach(() => {
    connectFn.mockClear()
    handleStartFn.mockClear()
    startFn.mockClear()
    createFn.mockClear()
  })

  it("connects to running sandbox", async () => {
    const getFn = mock(() =>
      Promise.resolve({
        status: "running",
        connect: connectFn,
        start: handleStartFn,
      }),
    )

    mock.module("microsandbox", () => ({
      Sandbox: { get: getFn, start: startFn, create: createFn },
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
    expect(handleStartFn).not.toHaveBeenCalled()
    expect(startFn).not.toHaveBeenCalled()
    expect(createFn).not.toHaveBeenCalled()
  })

  it("starts stopped sandbox via get", async () => {
    const getFn = mock(() =>
      Promise.resolve({
        status: "stopped",
        connect: connectFn,
        start: handleStartFn,
      }),
    )

    mock.module("microsandbox", () => ({
      Sandbox: { get: getFn, start: startFn, create: createFn },
      NetworkPolicy: { allowAll: () => ({}) },
      Mount: { bind: (p: string) => p },
    }))

    const { getOrCreateSandbox, SANDBOX_NAME, SANDBOX_IMAGE } = await import(
      "../src/index.ts?t=start-get"
    )
    const result = await getOrCreateSandbox(
      SANDBOX_NAME,
      SANDBOX_IMAGE,
      "/tmp",
      [],
    )

    expect(result.reused).toBe(true)
    expect(handleStartFn).toHaveBeenCalled()
    expect(connectFn).toHaveBeenCalled()
    expect(startFn).not.toHaveBeenCalled()
  })

  it("reconnects when create throws already exists", async () => {
    const getFn = mock(() => Promise.reject(new Error("not found")))
    const connectFn2 = mock(() => Promise.resolve("connected"))
    const handleFn = {
      status: "stopped",
      start: mock(() => Promise.resolve()),
      connect: connectFn2,
    }
    const createFn2 = mock()
      .mockImplementationOnce(() =>
        Promise.reject(new Error("sandbox 'x' already exists")),
      )
      .mockImplementationOnce(() => Promise.resolve("created"))

    mock.module("microsandbox", () => ({
      Sandbox: { get: getFn, start: startFn, create: createFn2 },
      NetworkPolicy: { allowAll: () => ({}) },
      Mount: { bind: (p: string) => p },
    }))

    getFn
      .mockImplementationOnce(() => Promise.reject(new Error("not found")))
      .mockImplementationOnce(() => Promise.resolve(handleFn))

    const { getOrCreateSandbox, SANDBOX_NAME, SANDBOX_IMAGE } = await import(
      "../src/index.ts?t=already-exists"
    )
    const result = await getOrCreateSandbox(
      SANDBOX_NAME,
      SANDBOX_IMAGE,
      "/tmp",
      [],
    )

    expect(result.reused).toBe(true)
    expect(handleFn.start).toHaveBeenCalled()
    expect(connectFn2).toHaveBeenCalled()
  })

  it("creates new sandbox when get and start both throw", async () => {
    const getFn = mock(() => Promise.reject(new Error("not found")))

    mock.module("microsandbox", () => ({
      Sandbox: { get: getFn, start: startFn, create: createFn },
      NetworkPolicy: { allowAll: () => ({}) },
      Mount: { bind: (p: string) => p },
    }))

    startFn.mockImplementationOnce(() =>
      Promise.reject(new Error("no sandbox")),
    )

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

  it("throws create error when sandbox does not exist", async () => {
    const getFn = mock(() => Promise.reject(new Error("not found")))
    const createErr = new Error("image pull failed")

    mock.module("microsandbox", () => ({
      Sandbox: { get: getFn, start: startFn, create: createFn },
      NetworkPolicy: { allowAll: () => ({}) },
      Mount: { bind: (p: string) => p },
    }))

    startFn.mockImplementationOnce(() =>
      Promise.reject(new Error("no sandbox")),
    )
    createFn.mockImplementationOnce(() => Promise.reject(createErr))

    const { getOrCreateSandbox, SANDBOX_NAME, SANDBOX_IMAGE } = await import(
      "../src/index.ts?t=create-err"
    )

    expect(
      getOrCreateSandbox(SANDBOX_NAME, SANDBOX_IMAGE, "/tmp", []),
    ).rejects.toThrow("image pull failed")
  })
})
