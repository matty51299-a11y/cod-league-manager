// Ported verbatim from the v0 project's lib/utils.ts (stripped of TS types only).
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
