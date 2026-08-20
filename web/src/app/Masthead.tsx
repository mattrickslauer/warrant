import Link from "next/link";
import { SignIn } from "@/auth/SignIn";

export function Masthead() {
  return (
    <header className="w-wrap masthead">
      <Link className="masthead__logo" href="/"><i aria-hidden />Warrant</Link>
      <nav className="masthead__nav">
        <Link href="/library">Library</Link>
        <Link href="/about">About</Link>
        <SignIn />
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="w-wrap footer">
      <span>Warrant</span>
      <span>Fixture data — no backend is connected yet</span>
    </footer>
  );
}
