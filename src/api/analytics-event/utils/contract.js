"use strict";

const EVENT_NAMES = new Set([
  "book_detail_viewed",
  "audio_play_started",
  "audio_play_ended",
  "audio_progress_reached",
  "audio_completed",
  "ebook_opened",
  "ebook_progress_reached",
  "ebook_completed",
  "book_download_started",
  "book_download_completed",
  "book_download_failed",
  "devotional_viewed",
  "devotional_engaged",
  "notification_opened",
  "search_performed",
  "search_result_opened",
  "bookmark_created",
  "purchase_link_opened",
]);

const CONTENT_TYPES = new Set(["book", "devotional", "app"]);
const PLATFORMS = new Set(["android", "ios", "macos", "web", "unknown"]);
const MEDIA_SOURCES = new Set(["streamed", "downloaded", "unknown"]);
const OUTCOMES = new Set(["success", "failed", "cancelled"]);
const SAFE_REASONS = new Set([
  "completed",
  "paused",
  "stopped",
  "backgrounded",
  "chapter_changed",
  "book_changed",
  "network",
  "storage",
  "cancelled",
  "unknown",
]);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_BATCH_SIZE = 25;
const MAX_OFFLINE_AGE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const EVENT_KEYS = new Set([
  "eventId",
  "eventName",
  "occurredAt",
  "contentType",
  "bookDocumentId",
  "chapterDocumentId",
  "devotionalId",
  "sourceSurface",
  "platform",
  "appVersion",
  "mediaSource",
  "playbackSessionId",
  "durationSeconds",
  "positionSeconds",
  "activeSeconds",
  "progressPercent",
  "resultCount",
  "outcome",
  "reason",
  "isResume",
]);
const BOOK_EVENTS = new Set([
  "book_detail_viewed",
  "ebook_opened",
  "ebook_progress_reached",
  "ebook_completed",
  "book_download_started",
  "book_download_completed",
  "book_download_failed",
  "search_result_opened",
  "bookmark_created",
  "purchase_link_opened",
]);
const DEVOTIONAL_EVENTS = new Set([
  "devotional_viewed",
  "devotional_engaged",
]);
const AUDIO_EVENTS = new Set([
  "audio_play_started",
  "audio_play_ended",
  "audio_progress_reached",
  "audio_completed",
]);

class AnalyticsValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AnalyticsValidationError";
  }
}

const requireObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AnalyticsValidationError(`${label} must be an object`);
  }
  return value;
};

const optionalString = (value, label, maxLength = 128) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new AnalyticsValidationError(
      `${label} must be a string of at most ${maxLength} characters`
    );
  }
  return value;
};

const identifier = (value, label, { min = 12, max = 128 } = {}) => {
  const parsed = optionalString(value, label, max);
  if (
    !parsed ||
    parsed.length < min ||
    !IDENTIFIER_PATTERN.test(parsed)
  ) {
    throw new AnalyticsValidationError(`${label} is invalid`);
  }
  return parsed;
};

const optionalEnum = (value, label, values) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (!values.has(value)) {
    throw new AnalyticsValidationError(`${label} is invalid`);
  }
  return value;
};

const optionalNumber = (value, label, { min = 0, max = 86400 } = {}) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AnalyticsValidationError(`${label} must be a finite number`);
  }
  if (value < min || value > max) {
    throw new AnalyticsValidationError(
      `${label} must be between ${min} and ${max}`
    );
  }
  return value;
};

const optionalInteger = (value, label, bounds) => {
  const parsed = optionalNumber(value, label, bounds);
  if (parsed !== undefined && !Number.isInteger(parsed)) {
    throw new AnalyticsValidationError(`${label} must be an integer`);
  }
  return parsed;
};

const optionalBoolean = (value, label) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new AnalyticsValidationError(`${label} must be a boolean`);
  }
  return value;
};

const occurredAt = (value, now) => {
  if (typeof value !== "string") {
    throw new AnalyticsValidationError("occurredAt must be an ISO timestamp");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AnalyticsValidationError("occurredAt must be an ISO timestamp");
  }
  if (parsed.getTime() < now.getTime() - MAX_OFFLINE_AGE_MS) {
    throw new AnalyticsValidationError("occurredAt is too old");
  }
  if (parsed.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) {
    throw new AnalyticsValidationError("occurredAt is in the future");
  }
  return parsed.toISOString();
};

const validateEvent = (rawEvent, now) => {
  const event = requireObject(rawEvent, "event");
  const unknownKey = Object.keys(event).find((key) => !EVENT_KEYS.has(key));
  if (unknownKey) {
    throw new AnalyticsValidationError(
      `${unknownKey} is not an allowed analytics property`
    );
  }
  const eventName = optionalEnum(event.eventName, "eventName", EVENT_NAMES);
  if (!eventName) {
    throw new AnalyticsValidationError("eventName is required");
  }

  const reason = optionalString(event.reason, "reason", 32);
  if (reason && !SAFE_REASONS.has(reason)) {
    throw new AnalyticsValidationError("reason is invalid");
  }

  const validated = {
    eventId: identifier(event.eventId, "eventId"),
    eventName,
    occurredAt: occurredAt(event.occurredAt, now),
    schemaVersion: 1,
    contentType: optionalEnum(
      event.contentType,
      "contentType",
      CONTENT_TYPES
    ),
    bookDocumentId: optionalString(
      event.bookDocumentId,
      "bookDocumentId",
      64
    ),
    chapterDocumentId: optionalString(
      event.chapterDocumentId,
      "chapterDocumentId",
      64
    ),
    devotionalId: optionalString(event.devotionalId, "devotionalId", 64),
    sourceSurface: optionalString(event.sourceSurface, "sourceSurface", 48),
    platform:
      optionalEnum(event.platform, "platform", PLATFORMS) || "unknown",
    appVersion: optionalString(event.appVersion, "appVersion", 32),
    mediaSource: optionalEnum(
      event.mediaSource,
      "mediaSource",
      MEDIA_SOURCES
    ),
    playbackSessionId: event.playbackSessionId
      ? identifier(event.playbackSessionId, "playbackSessionId", {
          min: 8,
          max: 128,
        })
      : undefined,
    durationSeconds: optionalNumber(
      event.durationSeconds,
      "durationSeconds"
    ),
    positionSeconds: optionalNumber(
      event.positionSeconds,
      "positionSeconds"
    ),
    activeSeconds: optionalNumber(event.activeSeconds, "activeSeconds"),
    progressPercent: optionalInteger(event.progressPercent, "progressPercent", {
      min: 0,
      max: 100,
    }),
    resultCount: optionalInteger(event.resultCount, "resultCount", {
      min: 0,
      max: 10000,
    }),
    outcome: optionalEnum(event.outcome, "outcome", OUTCOMES),
    reason,
    isResume: optionalBoolean(event.isResume, "isResume"),
  };

  if (BOOK_EVENTS.has(eventName) && !validated.bookDocumentId) {
    throw new AnalyticsValidationError(
      `${eventName} requires bookDocumentId`
    );
  }
  if (DEVOTIONAL_EVENTS.has(eventName) && !validated.devotionalId) {
    throw new AnalyticsValidationError(`${eventName} requires devotionalId`);
  }
  if (AUDIO_EVENTS.has(eventName)) {
    if (!validated.contentType) {
      throw new AnalyticsValidationError(`${eventName} requires contentType`);
    }
    if (
      validated.contentType === "book" &&
      !validated.bookDocumentId
    ) {
      throw new AnalyticsValidationError(
        `${eventName} requires bookDocumentId for book audio`
      );
    }
    if (
      validated.contentType === "devotional" &&
      !validated.devotionalId
    ) {
      throw new AnalyticsValidationError(
        `${eventName} requires devotionalId for devotional audio`
      );
    }
  }

  return validated;
};

const validateInstallationId = (value) =>
  identifier(value, "installationId", { min: 16, max: 128 });

const validateBatch = (payload, now = new Date()) => {
  const body = requireObject(payload, "body");
  const installationId = validateInstallationId(body.installationId);

  if (!Array.isArray(body.events) || body.events.length === 0) {
    throw new AnalyticsValidationError("events must be a non-empty array");
  }
  if (body.events.length > MAX_BATCH_SIZE) {
    throw new AnalyticsValidationError(
      `events cannot contain more than ${MAX_BATCH_SIZE} items`
    );
  }

  const events = body.events.map((event) => validateEvent(event, now));
  const eventIds = new Set(events.map((event) => event.eventId));
  if (eventIds.size !== events.length) {
    throw new AnalyticsValidationError("events contain duplicate eventId values");
  }

  return { installationId, events };
};

module.exports = {
  AnalyticsValidationError,
  EVENT_NAMES,
  MAX_BATCH_SIZE,
  validateBatch,
  validateInstallationId,
};
