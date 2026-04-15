interface Props {
  text: string
}

export function SystemNotice({ text }: Props) {
  return (
    <div className="text-center my-4">
      <p className="font-mono text-xs text-light italic">{text}</p>
    </div>
  )
}
