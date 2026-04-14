import { z } from "zod";

const youtubeThumbnailSchema = z.object({
  url: z.string().url().optional(),
});

const youtubeApiVideoSchema = z.object({
  id: z.string().min(1),
  snippet: z.object({
    channelId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional().default(""),
    publishedAt: z.string().datetime(),
    channelTitle: z.string().optional(),
    defaultLanguage: z.string().optional(),
    thumbnails: z.record(z.string(), youtubeThumbnailSchema).optional(),
  }),
  statistics: z.object({
    viewCount: z.string(),
    likeCount: z.string().optional(),
    commentCount: z.string().optional(),
  }),
  contentDetails: z
    .object({
      duration: z.string().optional(),
    })
    .optional(),
});

export const youtubeApiListSchema = z.object({
  items: z.array(youtubeApiVideoSchema),
});

export type YoutubeApiVideo = z.infer<typeof youtubeApiVideoSchema>;
