export const LABELS: readonly string[]
export function latest(tags: string[]): [number, number, number] | null
export function pickLabel(labels: string[]): { label: string } | { error: string }
export function nextVersion(tags: string[], label: string): string | null
export function plan(tags: string[], labels: string[]): { release: string } | { skip: string }
export function parseLabels(json: string): string[]
