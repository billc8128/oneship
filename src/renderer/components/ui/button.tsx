import { type ButtonHTMLAttributes, type ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
  children: ReactNode
  icon?: ReactNode
}

export function Button({ variant = 'primary', size = 'md', children, icon, className = '', ...props }: ButtonProps) {
  const base = 'inline-flex items-center gap-2 font-body font-medium transition-colors'
  const sizes = {
    sm: 'px-3 py-1.5 text-xs rounded-lg',
    md: 'px-4 py-2 text-sm rounded-xl',
  }
  const variants = {
    primary: 'bg-espresso text-canvas hover:bg-espresso/90',
    secondary: 'border border-border text-secondary hover:bg-sand',
    ghost: 'text-muted hover:text-secondary hover:bg-sand',
  }

  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props}>
      {icon}
      {children}
    </button>
  )
}
