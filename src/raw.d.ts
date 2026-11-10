// A stylesheet imported as text (`?raw`): Vitest provides it natively, the standalone build through its esbuild plugin.
// Kept out of the public declarations (not imported by any entry).
declare module '*.css?raw' {
  const text: string
  export default text
}
