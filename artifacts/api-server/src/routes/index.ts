import { Router, type IRouter } from "express";
import healthRouter from "./health";
import translationRouter from "./translate";
import cloudTranslationRouter from "./cloud-translate";

const router: IRouter = Router();

router.use(healthRouter);
router.use(translationRouter);
router.use(cloudTranslationRouter);

export default router;
