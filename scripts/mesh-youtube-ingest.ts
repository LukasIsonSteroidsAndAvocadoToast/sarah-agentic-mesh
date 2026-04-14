import { UniversalContentIngestService } from "@/core/services/UniversalContentIngestService";
import { youtubeApiListSchema, type YoutubeApiVideo } from "@/lib/mesh/youtubeSchema";

const CHANNEL_ID = process.env.MESH_YOUTUBE_CHANNEL_ID?.trim() || "UCipXVNRvJIBoZt7O_aPIgzg";
const MIN_VIEWS = Number(process.env.MESH_YOUTUBE_MIN_VIEWS?.trim() || "500");

function requireApiKey() {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) {
    throw new Error("YOUTUBE_API_KEY is required for mesh YouTube ingestion");
  }
  return key;
}

async function fetchChannelVideos(apiKey: string): Promise<YoutubeApiVideo[]> {
  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("key", apiKey);
  searchUrl.searchParams.set("channelId", CHANNEL_ID);
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("order", "date");
  searchUrl.searchParams.set("maxResults", "25");
  searchUrl.searchParams.set("type", "video");

  const searchRes = await fetch(searchUrl.toString());
  if (!searchRes.ok) {
    throw new Error(`YouTube search failed: ${searchRes.status} ${await searchRes.text()}`);
  }

  const searchJson = (await searchRes.json()) as {
    items?: Array<{ id?: { videoId?: string } }>;
  };
  const ids = (searchJson.items ?? []).map((item) => item.id?.videoId).filter(Boolean) as string[];
  if (ids.length === 0) return [];

  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set("key", apiKey);
  videosUrl.searchParams.set("id", ids.join(","));
  videosUrl.searchParams.set("part", "snippet,statistics,contentDetails");

  const videoRes = await fetch(videosUrl.toString());
  if (!videoRes.ok) {
    throw new Error(`YouTube videos lookup failed: ${videoRes.status} ${await videoRes.text()}`);
  }

  const json = youtubeApiListSchema.parse(await videoRes.json());
  return json.items;
}

async function main() {
  const apiKey = requireApiKey();
  const ingestService = new UniversalContentIngestService();
  const videos = await fetchChannelVideos(apiKey);
  const winners = videos.filter((video) => Number(video.statistics.viewCount) > MIN_VIEWS);

  for (const video of winners) {
    const content = {
      schemaVersion: "universal-content.v1" as const,
      sourcePlatform: "YOUTUBE" as const,
      externalId: video.id,
      sourceChannelId: video.snippet.channelId,
      canonicalUrl: `https://www.youtube.com/watch?v=${video.id}`,
      title: video.snippet.title,
      description: video.snippet.description || "",
      contentText: [video.snippet.title, video.snippet.description].filter(Boolean).join("\n\n"),
      transcriptText: undefined,
      languageCode: video.snippet.defaultLanguage,
      viewCount: Number(video.statistics.viewCount),
      likeCount: video.statistics.likeCount ? Number(video.statistics.likeCount) : undefined,
      commentCount: video.statistics.commentCount ? Number(video.statistics.commentCount) : undefined,
      publishedAt: video.snippet.publishedAt,
      discoveredAt: new Date().toISOString(),
      rawPayload: video as unknown as Record<string, unknown>,
    };

    const saved = await ingestService.ingest(content);
    console.log(`ingested_youtube_video ${video.id} -> ${saved.id}`);
  }
}

main().catch((error) => {
  console.error("mesh-youtube-ingest failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
