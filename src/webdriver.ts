// Driving a real browser, for anything in this project that needs one.
//
// Two things live here and neither belongs to a command: finding a chromedriver
// that matches the installed Chrome, and speaking W3C WebDriver to it. Both sat
// inside the test runner until a second caller wanted them, which is the moment
// a helper stops being one command's business.
//
// There is no library under this. Six endpoints cover a whole run, so the
// protocol layer is small enough that a dependency would cost more than it
// saves.
import { spawn, execFileSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs"
import { join } from "node:path"

// W3C's fixed key for a web element reference. Every conforming driver returns
// this exact string, which is why it can be a constant here.
export const ELEMENT = "element-6066-11e4-a52e-4f735466cecf"

const BUILDS = "https://googlechromelabs.github.io/chrome-for-testing/latest-patch-versions-per-build-with-downloads.json"

// Where a run looks for Chrome when CHROME_PATH says nothing. Ordered by
// platform, and a miss here is a clear error rather than a guess: the caller
// names the variable to set.
const CHROME_GUESSES: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
  win32: ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"],
}

const PLATFORMS: Record<string, string> = {
  "darwin-arm64": "mac-arm64",
  "darwin-x64": "mac-x64",
  "linux-x64": "linux64",
  "win32-x64": "win64",
}

export function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

export function chromePath(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  for (const guess of CHROME_GUESSES[process.platform] ?? []) {
    if (existsSync(guess)) return guess
  }
  throw new Error("no Chrome found — set CHROME_PATH to the browser binary")
}

// The build number, which is the version without its patch. A driver matches
// Chrome by build, so 150.0.7871.124 drives 150.0.7871.189 and the exact patch
// never has to line up.
function chromeBuild(binary: string): string {
  const printed = execFileSync(binary, ["--version"], { encoding: "utf8" })
  const found = /(\d+\.\d+\.\d+)\.\d+/.exec(printed)
  if (!found) throw new Error(`could not read a version out of "${printed.trim()}"`)
  return found[1]
}

function unpack(zip: string, into: string): void {
  // Node ships no zip reader, so this borrows one. unzip covers macOS and every
  // CI image; bsdtar reads zip too and covers Windows.
  try {
    execFileSync("unzip", ["-oq", zip, "-d", into], { stdio: "ignore" })
  } catch {
    execFileSync("tar", ["-xf", zip, "-C", into], { stdio: "ignore" })
  }
}

/**
 * A driver matching the installed Chrome, downloaded once and kept.
 *
 * Cached under node_modules, so git already ignores it and a clean checkout
 * already expects to rebuild it. A machine that has one already says so through
 * CHROMEWEBDRIVER, which is what CI sets.
 */
export async function chromedriver(root: string): Promise<string> {
  if (process.env.CHROMEWEBDRIVER) {
    const given = join(process.env.CHROMEWEBDRIVER, "chromedriver")
    if (existsSync(given)) return given
  }
  const build = chromeBuild(chromePath())
  const platform = PLATFORMS[`${process.platform}-${process.arch}`]
  if (!platform) throw new Error(`Chrome for Testing publishes no driver for ${process.platform}-${process.arch}`)

  const cache = join(root, "node_modules", ".cache", "mycelium", `chromedriver-${build}-${platform}`)
  const binary = join(cache, `chromedriver-${platform}`, process.platform === "win32" ? "chromedriver.exe" : "chromedriver")
  if (existsSync(binary)) return binary

  const catalogue = await (await fetch(BUILDS)).json()
  const downloads = catalogue.builds?.[build]?.downloads?.chromedriver
  const match = (downloads ?? []).find((entry: { platform: string }) => entry.platform === platform)
  if (!match) throw new Error(`Chrome for Testing lists no ${platform} driver for build ${build}`)

  console.log(`downloading chromedriver ${build} for ${platform}`)
  mkdirSync(cache, { recursive: true })
  const zip = join(cache, "chromedriver.zip")
  writeFileSync(zip, Buffer.from(await (await fetch(match.url)).arrayBuffer()))
  unpack(zip, cache)
  rmSync(zip, { force: true })
  if (!existsSync(binary)) throw new Error(`the driver archive held no ${binary}`)
  chmodSync(binary, 0o755)
  return binary
}

export type Call = (method: string, path: string, body?: unknown) => Promise<any>

// A thin WebDriver client against one running driver.
export function session(base: string): Call {
  return async function call(method, path, body) {
    const response = await fetch(base + path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const payload = await response.json()
    if (!response.ok) {
      const value = payload.value ?? {}
      throw new Error(`${value.error ?? "webdriver error"}: ${(value.message ?? "").split("\n")[0]}`)
    }
    return payload.value
  }
}

export interface BrowserOptions {
  root: string
  show?: boolean
  port?: number
  width?: number
  height?: number
}

/**
 * Run something against a live browser, and put the browser away afterwards.
 *
 * The caller gets `call`, already inside a session, and never sees the driver
 * process or the handshake. Everything this sets up it also tears down, on the
 * way out and on the way out through a throw.
 */
export async function withBrowser<T>(options: BrowserOptions, body: (call: Call) => Promise<T>): Promise<T> {
  const driver = await chromedriver(options.root)
  const port = options.port ?? 9515
  const server = spawn(driver, [`--port=${port}`], { stdio: "ignore" })
  const call = session(`http://127.0.0.1:${port}`)
  try {
    for (let tries = 0; ; tries++) {
      try { await call("GET", "/status"); break } catch (err) {
        if (tries > 50) throw err
        await sleep(100)
      }
    }
    const width = options.width ?? 1600
    const height = options.height ?? 1200
    const args = ["--no-sandbox", `--window-size=${width},${height}`]
    if (!options.show) args.push("--headless=new", "--disable-gpu")
    const made = await call("POST", "/session", {
      capabilities: { alwaysMatch: { browserName: "chrome", "goog:chromeOptions": { args, binary: chromePath() } } },
    })
    const at = `/session/${made.sessionId}`
    try {
      return await body((method, path, payload) => call(method, at + path, payload))
    } finally {
      await call("DELETE", at).catch(() => {})
    }
  } finally {
    server.kill()
  }
}
