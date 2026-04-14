import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tvAuthRouter from "./tvAuth";
import historyRouter from "./history";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tvAuthRouter);
router.use(historyRouter);

export default router;
