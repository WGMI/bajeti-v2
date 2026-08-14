import { sql } from "@/lib/db";
import { deleteFromCloudinary } from "@/lib/cloudinary";

type StoredAttachment = {
  id: string;
  public_id: string;
  resource_type: string;
};

type AttachmentInput = {
  publicId: string;
  secureUrl: string;
  resourceType: string;
  format: string | null;
  originalFilename: string | null;
  bytes: number | null;
};

function stringFromRecord(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function nullableStringFromRecord(record: Record<string, unknown>, ...keys: string[]) {
  const value = stringFromRecord(record, ...keys);
  return value || null;
}

function nullableBytesFromRecord(record: Record<string, unknown>) {
  const value = record.bytes;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
  }
  return null;
}

export function parseAttachmentInputs(value: unknown): AttachmentInput[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const attachments: AttachmentInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const publicId = stringFromRecord(record, "publicId", "public_id");
    const secureUrl = stringFromRecord(record, "secureUrl", "secure_url", "url");
    if (!publicId || !secureUrl || seen.has(publicId)) continue;
    seen.add(publicId);
    attachments.push({
      publicId,
      secureUrl,
      resourceType: stringFromRecord(record, "resourceType", "resource_type") || "image",
      format: nullableStringFromRecord(record, "format"),
      originalFilename: nullableStringFromRecord(
        record,
        "originalFilename",
        "original_filename",
        "filename"
      ),
      bytes: nullableBytesFromRecord(record),
    });
  }
  return attachments;
}

export async function insertTransactionAttachments(input: {
  transactionId: string;
  groupId: string | null;
  userId: string;
  attachments: AttachmentInput[];
}) {
  for (const attachment of input.attachments) {
    await sql`
      INSERT INTO transaction_attachments (
        transaction_id,
        group_id,
        uploaded_by_user_id,
        public_id,
        secure_url,
        resource_type,
        format,
        original_filename,
        bytes
      )
      VALUES (
        ${input.transactionId},
        ${input.groupId},
        ${input.userId},
        ${attachment.publicId},
        ${attachment.secureUrl},
        ${attachment.resourceType},
        ${attachment.format},
        ${attachment.originalFilename},
        ${attachment.bytes}
      )
    `;
  }
}

export async function reconcileTransactionAttachments(input: {
  transactionId: string;
  groupId: string | null;
  userId: string;
  attachments: AttachmentInput[] | null;
}) {
  if (input.attachments == null) return;

  const existing = (await sql`
    SELECT id, public_id, resource_type
    FROM transaction_attachments
    WHERE transaction_id = ${input.transactionId}
  `) as StoredAttachment[];

  const incomingPublicIds = new Set(input.attachments.map((attachment) => attachment.publicId));
  const existingPublicIds = new Set(existing.map((attachment) => attachment.public_id));
  const removed = existing.filter((attachment) => !incomingPublicIds.has(attachment.public_id));
  const added = input.attachments.filter(
    (attachment) => !existingPublicIds.has(attachment.publicId)
  );

  if (removed.length > 0) {
    await sql`
      DELETE FROM transaction_attachments
      WHERE id IN (
        SELECT (jsonb_array_elements_text(${JSON.stringify(
          removed.map((attachment) => attachment.id)
        )}::jsonb))::uuid
      )
    `;
    await deleteCloudinaryAttachments(removed);
  }

  if (added.length > 0) {
    await insertTransactionAttachments({
      transactionId: input.transactionId,
      groupId: input.groupId,
      userId: input.userId,
      attachments: added,
    });
  }
}

export async function getAttachmentsForTransactions(transactionIds: string[]) {
  if (transactionIds.length === 0) return [];
  return (await sql`
    SELECT id, public_id, resource_type
    FROM transaction_attachments
    WHERE transaction_id IN (
      SELECT (jsonb_array_elements_text(${JSON.stringify(transactionIds)}::jsonb))::uuid
    )
  `) as StoredAttachment[];
}

export async function deleteCloudinaryAttachments(attachments: StoredAttachment[]) {
  await Promise.all(
    attachments.map(async (attachment) => {
      try {
        await deleteFromCloudinary(attachment.public_id, attachment.resource_type || "image");
      } catch (error) {
        console.error("Failed to delete Cloudinary attachment", {
          attachmentId: attachment.id,
          publicId: attachment.public_id,
          error,
        });
      }
    })
  );
}
