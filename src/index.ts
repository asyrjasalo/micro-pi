#!/usr/bin/env node

import { Sandbox, Secret, NetworkPolicy, isInstalled, install, Mount } from "microsandbox";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const SANDBOX_NAME = "pi-coding-agent";
const SANDBOX_IMAGE = "node:24-slim";
const GUEST_WORKDIR = "/workspace";

async function main(): Promise<void> {
  const projectDir = resolve(process.argv[2] || process.cwd());

  if (!existsSync(projectDir)) {
    console.error(`Project directory not found: ${projectDir}`);
    process.exit(1);
  }

  if (!isInstalled()) {
    console.error("Installing microsandbox runtime...");
    await install();
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const zaiApiKey = process.env.ZAI_API_KEY;
  const minimaxApiKey = process.env.MINIMAX_API_KEY;

  if (!apiKey && !zaiApiKey && !minimaxApiKey) {
    console.error("At least one API key required: ANTHROPIC_API_KEY, ZAI_API_KEY, or MINIMAX_API_KEY.");
    process.exit(1);
  }

  const secrets = [];
  if (apiKey) {
    secrets.push(
      Secret.env("ANTHROPIC_API_KEY", {
        value: apiKey,
        allowHosts: ["api.anthropic.com"],
      }),
    );
  }
  if (zaiApiKey) {
    secrets.push(
      Secret.env("ZAI_API_KEY", {
        value: zaiApiKey,
        allowHosts: ["api.z.ai", "open.bigmodel.cn"],
      }),
    );
  }
  if (minimaxApiKey) {
    secrets.push(
      Secret.env("MINIMAX_API_KEY", {
        value: minimaxApiKey,
        allowHosts: ["api.minimax.io", "api.minimax.chat"],
      }),
    );
  }

  console.error(`Creating sandbox (image: ${SANDBOX_IMAGE}, cpus: 2, mem: 2048 MiB)...`);
  const sb = await Sandbox.create({
    name: SANDBOX_NAME,
    image: SANDBOX_IMAGE,
    cpus: 2,
    memoryMib: 2048,
    replace: true,
    workdir: GUEST_WORKDIR,
    volumes: { [GUEST_WORKDIR]: Mount.bind(projectDir) },
    secrets,
    network: NetworkPolicy.allowAll(),
    quietLogs: true,
  });

  try {
    // Install pi coding agent
    console.error("Installing pi coding agent...");
    const installResult = await sb.exec("npm", [
      "install",
      "-g",
      "@mariozechner/pi-coding-agent",
    ]);
    if (!installResult.success) {
      console.error("Failed to install pi:");
      console.error(installResult.stderr());
      await sb.kill();
      process.exit(1);
    }

    // Hand over terminal to pi — user interacts directly
    console.error("Starting pi coding agent (Ctrl+] to detach)...\n");
    const exitCode = await sb.attachWithConfig({
      cmd: "pi",
      cwd: GUEST_WORKDIR,
    });

    process.exit(exitCode);
  } catch (err) {
    console.error("Error:", err);
    await sb.kill();
    process.exit(1);
  } finally {
    // Best-effort cleanup
    try {
      await sb.stop();
    } catch {
      // already stopped or killed
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
