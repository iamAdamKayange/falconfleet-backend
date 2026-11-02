import { z } from "zod";
export const collections = [
  "routes",
  "students",
  "trips",
  "maintenance",
  "fuel",
  "sms",
  "users",
  "alerts",
  "fleet",
];
export const recordSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    detail: z.string().trim().min(1).max(180),
    extra: z.string().trim().max(240).default(""),
    status: z
      .enum([
        "Draft",
        "Pending",
        "Scheduled",
        "Open",
        "Acknowledged",
        "In progress",
        "Completed",
        "Approved",
        "Assigned",
        "Active",
        "Reported",
        "In repair",
        "At school",
      ])
      .default("Draft"),
    amount: z.number().positive().max(100000000).optional(),
  })
  .strict();
