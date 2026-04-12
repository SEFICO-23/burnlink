export const metadata = { title: "Try again in a moment" };

export default function SoldOut() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-bg text-text">
      <div className="max-w-md text-center p-8">
        <h1 className="text-2xl font-semibold mb-2">Momentarily unavailable</h1>
        <p className="text-muted">
          We&apos;re preparing a fresh invitation for you. Please refresh this page in a few
          seconds.
        </p>
      </div>
    </main>
  );
}
