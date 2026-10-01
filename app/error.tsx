'use client';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page">
      <div className="empty">
        <strong>This page couldn't load</strong>
        <p>{error.message}</p>
        <p className="small" style={{ marginTop: 8 }}>Check that DATABASE_URL is set and the schema is applied (npm run db:migrate).</p>
        <button className="btn" style={{ marginTop: 16 }} onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
