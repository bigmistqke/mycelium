export {}

declare global {
  var mycelium: {
    loadModule(scriptSource: string): Promise<Record<string, unknown>>
    loadCheck(scriptSource: string): Promise<(...args: unknown[]) => unknown>
  }
}
