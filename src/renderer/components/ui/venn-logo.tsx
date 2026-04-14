interface VennLogoProps {
  size?: number
  className?: string
}

export function VennLogo({ size = 26, className }: VennLogoProps) {
  const r = size * 0.35
  const cx1 = r
  const cx2 = size - r
  const cy = size / 2

  return (
    <svg width={size} height={size * 0.7} viewBox={`0 0 ${size} ${size * 0.7}`} className={className}>
      <circle cx={cx1} cy={cy * 0.7} r={r} fill="#2C2520" />
      <circle cx={cx2} cy={cy * 0.7} r={r} fill="#2C2520" opacity={0.35} />
    </svg>
  )
}
