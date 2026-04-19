#!/usr/bin/env node

import { Sandbox } from "microsandbox"
import { SANDBOX_NAME } from "./index.js"

async function clean(): Promise<void> {
  try {
    await Sandbox.remove(SANDBOX_NAME)
    console.log(`Removed sandbox "${SANDBOX_NAME}".`)
  } catch {
    console.log(`No sandbox "${SANDBOX_NAME}" found (already clean).`)
  }
}

clean().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
