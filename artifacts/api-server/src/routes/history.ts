import { Router } from "express";
import { getTickDb } from "../lib/tickDb";

const router = Router();

router.get("/history/:symbol", (req, res) => {
  const symbol = req.params.symbol;
  const since = Number(req.query.since ?? 0);

  if (!symbol) {
    res.status(400).json({ error: "symbol is required" });
    return;
  }

  const db = getTickDb();
  const ticks = db.getTicks(symbol, since);
  const ob = db.getOB(symbol, since);

  res.json({ symbol, ticks, ob });
});

export default router;
