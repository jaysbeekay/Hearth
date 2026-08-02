import { z } from "zod";

export const feedbackSchema = z.object({
  category: z.enum(["BUG", "ENHANCEMENT"]),
  title: z
    .string()
    .trim()
    .min(1, "A short title is required")
    .max(120, "Keep the title to 120 characters or fewer")
    .refine((value) => !/[\r\n]/.test(value), "Title must be one line"),
  details: z
    .string()
    .trim()
    .min(10, "Please include a little more detail")
    .max(10_000, "Keep the details to 10,000 characters or fewer"),
});

export type FeedbackCategory = z.infer<typeof feedbackSchema>["category"];
