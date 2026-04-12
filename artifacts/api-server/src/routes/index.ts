import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tvAuthRouter from "./tvAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tvAuthRouter);

export default router;
