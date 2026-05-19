import Link from "next/link";

export default function HomePage() {
  return (
    <section className="page-section">
      <h1>Seat reservation</h1>
      <Link href="/seats" className="button-link">
        View seats
      </Link>
    </section>
  );
}
