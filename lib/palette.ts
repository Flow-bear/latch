// Shared palette: warm intimate (cream/saumon day, espresso/cream night).
// Kept as Tailwind class strings so it inlines into the JIT bundle.

export type Palette = {
  bg: string
  text: string
  muted: string
  soft: string
  ring: string
  ringStrong: string
  hoverFill: string
  cardBg: string
  cardBorder: string
  inputBg: string
  accent: string
  accentText: string
  emojiSelectedBg: string
  emojiSelectedRing: string
  emojiBg: string
}

const day: Palette = {
  bg: 'bg-[#f7f2e9]',
  text: 'text-[#2c241e]',
  muted: 'text-[#2c241e]/55',
  soft: 'text-[#2c241e]/75',
  ring: 'border-[#2c241e]/15',
  ringStrong: 'border-[#2c241e]/40',
  hoverFill: 'active:bg-[#2c241e]/5',
  cardBg: 'bg-[#efe7d7]',
  cardBorder: 'border-[#2c241e]/10',
  inputBg: 'bg-white',
  accent: 'bg-[#b07050]',
  accentText: 'text-[#f7f2e9]',
  emojiSelectedBg: 'bg-[#2c241e]/8',
  emojiSelectedRing: 'ring-[#2c241e]/40',
  emojiBg: 'bg-[#efe7d7]',
}

const night: Palette = {
  bg: 'bg-[#1a1410]',
  text: 'text-[#d4b896]',
  muted: 'text-[#d4b896]/55',
  soft: 'text-[#d4b896]/75',
  ring: 'border-[#d4b896]/25',
  ringStrong: 'border-[#d4b896]/50',
  hoverFill: 'active:bg-[#d4b896]/10',
  cardBg: 'bg-[#241c17]',
  cardBorder: 'border-[#d4b896]/15',
  inputBg: 'bg-[#241c17]',
  accent: 'bg-[#c89878]',
  accentText: 'text-[#1a1410]',
  emojiSelectedBg: 'bg-[#d4b896]/15',
  emojiSelectedRing: 'ring-[#d4b896]/50',
  emojiBg: 'bg-[#241c17]',
}

export function getPalette(isNight: boolean): Palette {
  return isNight ? night : day
}
