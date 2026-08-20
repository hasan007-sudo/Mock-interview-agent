import { z } from "zod";

export const MockInterviewConfigSchema = z.object({}).strict();

export const MockInterviewRequestSchema = z
  .object({
    type: z.literal("mock_interview"),
    version: z.literal("v1"),
    config: MockInterviewConfigSchema,
  })
  .strict();

export const ResumeRoundSchema = z.enum(["round_1", "round_2", "round_3"]);

export const ResumeMasteryConfigSchema = z
  .object({
    max_follow_ups: z.number().int().min(0).max(3).default(3),
  })
  .strict();

export const ResumeInterviewRequestSchema = z
  .object({
    type: z.literal("resume_mastery"),
    version: z.literal("v1"),
    round: ResumeRoundSchema,
    config: ResumeMasteryConfigSchema,
  })
  .strict();

export const InterviewRequestSchema = z.discriminatedUnion("type", [
  MockInterviewRequestSchema,
  ResumeInterviewRequestSchema,
]);

export type MockInterviewConfig = z.infer<typeof MockInterviewConfigSchema>;
export type MockInterviewRequest = z.infer<typeof MockInterviewRequestSchema>;
export type ResumeRound = z.infer<typeof ResumeRoundSchema>;
export type ResumeMasteryConfig = z.infer<
  typeof ResumeMasteryConfigSchema
>;
export type ResumeInterviewRequest = z.infer<
  typeof ResumeInterviewRequestSchema
>;
export type InterviewRequest = z.infer<typeof InterviewRequestSchema>;
