import { Router } from "express";
import type { RequestHandler } from "express";
import fs from "fs";
import multer from "multer";

import { processWordHttpJson } from "../controllers/wordController";
import { getJob } from "../controllers/utils/wordJobStore";

const upload = multer({ dest: "uploads/" });
const router = Router();

export const downloadJobZip: RequestHandler = (req, res) => {
    const jobIdRaw = req.params.jobId;
    const jobId = Array.isArray(jobIdRaw) ? jobIdRaw[0] : jobIdRaw;
  
    const job = getJob(jobId);
    if (!job?.done) return res.status(404).json({ error: "Job not finished" });
  
    const zipPath = job?.result?.zipPath as string | undefined;
    if (!zipPath) return res.status(404).json({ error: "Zip not found" });
    if (!fs.existsSync(zipPath)) return res.status(404).json({ error: "Zip file missing on disk" });
  
    const safeName = String(job.result?.fileName || "output").replace(/[^\w.\- ]+/g, "_");
    return res.download(zipPath, `${safeName}.zip`);
  };  

router.post("/json", upload.array("files", 10), processWordHttpJson);

router.get("/json/status/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "job not found" });
  return res.json(job);
});

router.post("/json/status/batch", (req, res) => {
  const ids = req.body.ids as string[];
  const statuses = ids.map((id: string) => {
    const job = getJob(id);
    return {
      jobId: id,
      ...(job || { label: "not found", done: true, error: true }),
    };
  });
  return res.json(statuses);
});

router.get("/json/download/:jobId", downloadJobZip);

export default router;
