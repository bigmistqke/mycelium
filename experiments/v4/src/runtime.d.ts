export {}

declare global {
  var mycelium: {
    loadCheck(scriptSource: string): Promise<(...args: unknown[]) => unknown>
  }
}
