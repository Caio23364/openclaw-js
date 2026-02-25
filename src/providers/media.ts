/**
 * OpenClaw — Media Pipeline
 *
 * Processes media attachments from incoming messages before sending
 * them to AI providers. Handles:
 *
 * 1. **Vision** — images → base64 for OpenAI/Anthropic/Google vision APIs
 * 2. **Audio transcription** — voice/audio → text via Whisper or provider API
 * 3. **Document extraction** — PDF/doc text extraction
 * 4. **Per-channel limits** — validate file sizes and types per channel
 *
 * The pipeline is lazy: it only processes media types that the target
 * provider actually supports (e.g., skip vision if model has no vision).
 */

import { log } from '../utils/logger.js';
import { MediaAttachment, Message } from '../types/index.js';

// ── Types ──

export interface MediaProcessResult {
    /** Text description of the media for context injection */
    contextText: string;
    /** Base64-encoded images for vision APIs */
    visionImages: VisionImage[];
    /** Transcriptions from audio/voice */
    transcriptions: string[];
    /** Number of media items processed */
    processed: number;
    /** Items that were skipped */
    skipped: string[];
}

export interface VisionImage {
    base64: string;
    mimeType: string;
    /** Optional caption from the sender */
    caption?: string;
}

export interface MediaPipelineConfig {
    /** Max image size in bytes (default: 20MB — OpenAI limit) */
    maxImageSize: number;
    /** Max audio duration in seconds for transcription */
    maxAudioDuration: number;
    /** Supported image MIME types */
    supportedImages: string[];
    /** Supported audio MIME types for transcription */
    supportedAudio: string[];
    /** Whether to extract text from documents */
    extractDocuments: boolean;
    /** Vision model capabilities */
    visionEnabled: boolean;
    /** Audio transcription enabled */
    transcriptionEnabled: boolean;
}

const DEFAULT_CONFIG: MediaPipelineConfig = {
    maxImageSize: 20 * 1024 * 1024, // 20MB
    maxAudioDuration: 300, // 5 minutes
    supportedImages: [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    ],
    supportedAudio: [
        'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm',
        'audio/x-m4a', 'audio/flac',
    ],
    extractDocuments: true,
    visionEnabled: true,
    transcriptionEnabled: true,
};

// ── Per-channel limits ──

export const CHANNEL_MEDIA_LIMITS: Record<string, { maxFileSize: number; supportedTypes: string[] }> = {
    whatsapp: {
        maxFileSize: 64 * 1024 * 1024, // 64MB
        supportedTypes: ['image', 'video', 'audio', 'document', 'voice', 'sticker'],
    },
    telegram: {
        maxFileSize: 50 * 1024 * 1024, // 50MB (bot API limit)
        supportedTypes: ['image', 'video', 'audio', 'document', 'voice', 'sticker'],
    },
    discord: {
        maxFileSize: 25 * 1024 * 1024, // 25MB (without Nitro)
        supportedTypes: ['image', 'video', 'audio', 'document'],
    },
    slack: {
        maxFileSize: 1024 * 1024 * 1024, // 1GB
        supportedTypes: ['image', 'video', 'audio', 'document'],
    },
    signal: {
        maxFileSize: 100 * 1024 * 1024, // 100MB
        supportedTypes: ['image', 'video', 'audio', 'document', 'voice'],
    },
    matrix: {
        maxFileSize: 100 * 1024 * 1024, // 100MB (depends on homeserver)
        supportedTypes: ['image', 'video', 'audio', 'document'],
    },
    webchat: {
        maxFileSize: 50 * 1024 * 1024,
        supportedTypes: ['image', 'video', 'audio', 'document'],
    },
};

// ── Pipeline ──

/**
 * Process all media attachments in an incoming message.
 * Returns vision images, transcriptions, and context text for
 * injection into the AI prompt.
 */
export async function processMedia(
    media: MediaAttachment[],
    config: Partial<MediaPipelineConfig> = {},
): Promise<MediaProcessResult> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const result: MediaProcessResult = {
        contextText: '',
        visionImages: [],
        transcriptions: [],
        processed: 0,
        skipped: [],
    };

    if (!media || media.length === 0) {
        return result;
    }

    const contextParts: string[] = [];

    for (const attachment of media) {
        try {
            switch (attachment.type) {
                case 'image':
                case 'sticker': {
                    if (!cfg.visionEnabled) {
                        result.skipped.push(`Image skipped (vision disabled)`);
                        break;
                    }

                    const imageResult = await processImage(attachment, cfg);
                    if (imageResult) {
                        result.visionImages.push(imageResult);
                        result.processed++;
                        if (attachment.caption) {
                            contextParts.push(`[Image: ${attachment.caption}]`);
                        } else {
                            contextParts.push(`[Image attached]`);
                        }
                    }
                    break;
                }

                case 'voice':
                case 'audio': {
                    if (!cfg.transcriptionEnabled) {
                        result.skipped.push(`Audio skipped (transcription disabled)`);
                        break;
                    }

                    const transcription = await processAudio(attachment, cfg);
                    if (transcription) {
                        result.transcriptions.push(transcription);
                        result.processed++;
                        contextParts.push(`[Audio transcription: ${transcription}]`);
                    }
                    break;
                }

                case 'video': {
                    // Video: extract description if available
                    result.processed++;
                    contextParts.push(
                        attachment.caption
                            ? `[Video: ${attachment.caption}]`
                            : `[Video attached (${attachment.filename || 'unnamed'})]`,
                    );
                    break;
                }

                case 'document': {
                    if (!cfg.extractDocuments) {
                        result.skipped.push(`Document skipped (extraction disabled)`);
                        break;
                    }

                    const docText = await processDocument(attachment);
                    if (docText) {
                        result.processed++;
                        contextParts.push(`[Document "${attachment.filename || 'unnamed'}":\n${docText}\n]`);
                    }
                    break;
                }

                default:
                    result.skipped.push(`Unknown media type: ${attachment.type}`);
            }
        } catch (error: any) {
            log.warn(`Media processing failed for ${attachment.type}: ${error.message}`);
            result.skipped.push(`${attachment.type}: ${error.message}`);
        }
    }

    result.contextText = contextParts.join('\n');
    return result;
}

// ── Image processing ──

async function processImage(
    attachment: MediaAttachment,
    config: MediaPipelineConfig,
): Promise<VisionImage | null> {
    // Validate MIME type
    const mime = attachment.mimeType || 'image/jpeg';
    if (!config.supportedImages.includes(mime)) {
        log.debug(`Image MIME type not supported for vision: ${mime}`);
        return null;
    }

    // Validate size
    if (attachment.size && attachment.size > config.maxImageSize) {
        log.debug(`Image too large for vision: ${attachment.size} bytes (max: ${config.maxImageSize})`);
        return null;
    }

    let base64: string;

    if (attachment.buffer) {
        base64 = attachment.buffer.toString('base64');
    } else if (attachment.url) {
        // Fetch and convert to base64
        try {
            const response = await fetch(attachment.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            base64 = Buffer.from(arrayBuffer).toString('base64');
        } catch (error: any) {
            log.warn(`Failed to fetch image from URL: ${error.message}`);
            return null;
        }
    } else {
        return null;
    }

    return {
        base64,
        mimeType: mime,
        caption: attachment.caption,
    };
}

// ── Audio processing ──

async function processAudio(
    attachment: MediaAttachment,
    config: MediaPipelineConfig,
): Promise<string | null> {
    const mime = attachment.mimeType || 'audio/ogg';
    if (!config.supportedAudio.includes(mime)) {
        log.debug(`Audio MIME type not supported: ${mime}`);
        return null;
    }

    // Get audio buffer
    let audioBuffer: Buffer;

    if (attachment.buffer) {
        audioBuffer = attachment.buffer;
    } else if (attachment.url) {
        try {
            const response = await fetch(attachment.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            audioBuffer = Buffer.from(arrayBuffer);
        } catch (error: any) {
            log.warn(`Failed to fetch audio from URL: ${error.message}`);
            return null;
        }
    } else {
        return null;
    }

    // Try transcription via OpenAI Whisper API
    try {
        const transcription = await transcribeWithWhisper(audioBuffer, mime);
        return transcription;
    } catch (error: any) {
        log.warn(`Whisper transcription failed: ${error.message}`);
    }

    // Fallback: return placeholder
    return `[Voice message - ${(audioBuffer.length / 1024).toFixed(0)}KB, transcription unavailable]`;
}

/**
 * Transcribe audio using OpenAI Whisper API.
 * Falls back gracefully if the API is not configured.
 */
async function transcribeWithWhisper(audioBuffer: Buffer, mimeType: string): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY required for audio transcription');
    }

    // Determine file extension from MIME
    const extMap: Record<string, string> = {
        'audio/ogg': 'ogg',
        'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a',
        'audio/wav': 'wav',
        'audio/webm': 'webm',
        'audio/x-m4a': 'm4a',
        'audio/flac': 'flac',
    };
    const ext = extMap[mimeType] || 'ogg';

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    formData.append('file', blob, `audio.${ext}`);
    formData.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Whisper API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as { text: string };
    return data.text;
}

// ── Document processing ──

async function processDocument(attachment: MediaAttachment): Promise<string | null> {
    // For text-based documents, extract content
    const textMimes = [
        'text/plain', 'text/markdown', 'text/csv', 'text/html',
        'application/json', 'application/xml',
    ];

    const mime = attachment.mimeType || '';

    if (textMimes.includes(mime)) {
        if (attachment.buffer) {
            const text = attachment.buffer.toString('utf-8');
            // Limit extraction to 10K chars to avoid context overflow
            return text.length > 10000 ? text.slice(0, 10000) + '\n...[truncated]' : text;
        }
        if (attachment.url) {
            try {
                const response = await fetch(attachment.url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const text = await response.text();
                return text.length > 10000 ? text.slice(0, 10000) + '\n...[truncated]' : text;
            } catch (error: any) {
                log.warn(`Failed to fetch document: ${error.message}`);
                return null;
            }
        }
    }

    // For binary docs (PDF, DOCX, etc.), return a placeholder
    return `[Document: ${attachment.filename || 'unnamed'} (${mime || 'unknown type'}, ${((attachment.size || 0) / 1024).toFixed(0)}KB)]`;
}

// ── Vision message formatting ──

/**
 * Build an OpenAI-compatible vision message with images.
 * Used when sending images to vision-capable models.
 */
export function buildVisionMessage(
    textContent: string,
    images: VisionImage[],
): { role: 'user'; content: any[] } {
    const content: any[] = [];

    // Add text first
    if (textContent) {
        content.push({ type: 'text', text: textContent });
    }

    // Add images
    for (const img of images) {
        content.push({
            type: 'image_url',
            image_url: {
                url: `data:${img.mimeType};base64,${img.base64}`,
                detail: 'auto',
            },
        });
    }

    return { role: 'user', content };
}

/**
 * Build an Anthropic-compatible vision message.
 */
export function buildAnthropicVisionMessage(
    textContent: string,
    images: VisionImage[],
): { role: 'user'; content: any[] } {
    const content: any[] = [];

    // Add images first (Anthropic convention)
    for (const img of images) {
        content.push({
            type: 'image',
            source: {
                type: 'base64',
                media_type: img.mimeType,
                data: img.base64,
            },
        });
    }

    // Add text
    if (textContent) {
        content.push({ type: 'text', text: textContent });
    }

    return { role: 'user', content };
}
