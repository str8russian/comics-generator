import pg from "pg";

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (typeof connectionString !== "string" || connectionString.length === 0) {
    const error = new Error("database-unavailable");
    error.code = "DATABASE_UNAVAILABLE";
    throw error;
  }
  const pool = new pg.Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 5000,
  });
  pool.on("error", () => {});
  return pool;
}
