/**
 * KafkaJS singleton for the Sovereign Mesh.
 * The producer is lazy-initialised on first use and reused across calls.
 * Import `getMeshProducer()` from this module everywhere you need to publish.
 */
import { Kafka, type Producer, type Consumer, CompressionTypes, logLevel } from "kafkajs";
import { getMeshEnv } from "@/lib/mesh/env";

let _kafka: Kafka | null = null;
let _producer: Producer | null = null;

function getKafka(): Kafka {
  if (!_kafka) {
    const env = getMeshEnv();
    _kafka = new Kafka({
      clientId: env.KAFKA_CLIENT_ID,
      brokers: env.KAFKA_BROKERS.split(","),
      logLevel: env.NODE_ENV === "production" ? logLevel.WARN : logLevel.INFO,
      retry: { retries: 5, initialRetryTime: 300 },
    });
  }
  return _kafka;
}

export async function getMeshProducer(): Promise<Producer> {
  if (!_producer) {
    _producer = getKafka().producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30_000,
    });
    await _producer.connect();
  }
  return _producer;
}

export async function disconnectProducer(): Promise<void> {
  if (_producer) {
    await _producer.disconnect();
    _producer = null;
  }
}

export function createMeshConsumer(groupId: string): Consumer {
  return getKafka().consumer({ groupId, sessionTimeout: 30_000 });
}

/**
 * Publish a single JSON message to a Kafka topic.
 * key should be a stable aggregate id for ordered delivery per entity.
 */
export async function publishToKafka(
  topic: string,
  key: string,
  value: unknown,
): Promise<void> {
  const producer = await getMeshProducer();
  await producer.send({
    topic,
    compression: CompressionTypes.GZIP,
    messages: [
      {
        key,
        value: JSON.stringify(value),
        headers: { "content-type": "application/json" },
      },
    ],
  });
}
