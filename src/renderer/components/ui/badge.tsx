import { type ReactNode } from 'react'

interface BadgeProps {
  variant: 'running' | 'active' | 'done' | 'planning' | 'cron'
  children: ReactNode
}

const styles = {
  running: 'bg-espresso/5 text-espresso',
  active: 'bg-success/8 text-success',
  done: 'bg-sand text-light',
  planning: 'bg-warning/8 text-warning',
  cron: 'bg-warning/8 text-orange-700',
}

export function Badge({ variant, children }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[variant]}`}>
      {children}
    </span>
  )
}
