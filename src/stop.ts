#!/usr/bin/env node

import { Sandbox } from "microsandbox"
import { SANDBOX_NAME } from "./index.js"

async function stop(): Promise<void> {
	try {
		const handle = await Sandbox.get(SANDBOX_NAME)
		await handle.stop()
		console.log(`Stopped sandbox "${SANDBOX_NAME}".`)
	} catch {
		console.log(`No running sandbox "${SANDBOX_NAME}" found.`)
	}
}

stop().catch((err) => {
	console.error("Fatal:", err)
	process.exit(1)
})
