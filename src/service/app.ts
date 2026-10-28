// HTTP API of the identity service. Only app backends call it, each with its own API key.
//
//   POST /v1/users/resolve      find or create the person for a phone, link the calling app's user row
//   GET  /v1/users/:id          a person and the apps they use
//   GET  /v1/users?phone=...    look a person up by phone
//   GET  /health                database reachable

import express, { type NextFunction, type Request, type Response } from "express";
import type pg from "pg";
import { requireAppKey } from "./auth.ts";
import { findByPhone, getUser, resolveUser, ServiceError } from "./store.ts";

export function createApp(pool: pg.Pool) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));

  app.get("/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  });

  const v1 = express.Router();
  v1.use(requireAppKey(pool));

  v1.post("/users/resolve", async (req, res) => {
    const { user, created } = await resolveUser(pool, res.locals.appKey, req.body ?? {});
    res.status(created ? 201 : 200).json({ created, user });
  });

  v1.get("/users/:id", async (req, res) => {
    const user = await getUser(pool, res.locals.appKey, req.params.id);
    if (!user) return res.status(404).json({ error: "not_found" });
    res.json({ user });
  });

  v1.get("/users", async (req, res) => {
    const user = await findByPhone(pool, res.locals.appKey, req.query.phone);
    if (!user) return res.status(404).json({ error: "not_found" });
    res.json({ user });
  });

  app.use("/v1", v1);
  app.use((_req, res) => res.status(404).json({ error: "not_found" }));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ServiceError) return res.status(error.status).json({ error: error.code, message: error.message });
    if ((error as { type?: string }).type === "entity.parse.failed") return res.status(400).json({ error: "invalid_json" });
    console.error(error);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
