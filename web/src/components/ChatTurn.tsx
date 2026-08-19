export function ChatTurn({
  who, side = "them", children,
}: { who: string; side?: "them" | "me"; children: React.ReactNode }) {
  return (
    <div className={`w-turn w-turn--${side}`}>
      <p className="w-turn__who">{who}</p>
      <p className="w-turn__body">{children}</p>
    </div>
  );
}
