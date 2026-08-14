import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { addGroupAuditEvent, requireGroupPermission } from "@/lib/groups";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const transactionId = formData.get("transactionId");
    if (!(file instanceof File) || typeof transactionId !== "string" || !transactionId) {
      return NextResponse.json({ error: "File and transactionId are required" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "Attachment must be 10MB or smaller" }, { status: 400 });
    }

    const txRows = await sql`
      SELECT id, user_id, group_id
      FROM transactions
      WHERE id = ${transactionId}
      LIMIT 1
    `;
    const tx = txRows[0] as
      | { id: string; user_id: string; group_id: string | null }
      | undefined;
    if (!tx) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    if (tx.group_id) {
      try {
        await requireGroupPermission(userId, tx.group_id, "edit_transactions");
      } catch {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (tx.user_id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const uploaded = await uploadToCloudinary(file, `bajeti/transactions/${transactionId}`);
    const rows = await sql`
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
        ${transactionId},
        ${tx.group_id},
        ${userId},
        ${uploaded.public_id},
        ${uploaded.secure_url},
        ${uploaded.resource_type},
        ${uploaded.format ?? null},
        ${uploaded.original_filename ?? file.name},
        ${uploaded.bytes ?? file.size}
      )
      RETURNING
        id,
        public_id,
        secure_url,
        resource_type,
        format,
        original_filename,
        bytes,
        created_at::text AS created_at
    `;
    const attachment = rows[0];
    if (tx.group_id) {
      await addGroupAuditEvent({
        groupId: tx.group_id,
        actorUserId: userId,
        entityType: "transaction_attachment",
        entityId: attachment?.id ? String(attachment.id) : null,
        action: "created",
        metadata: { transactionId, filename: file.name },
      });
    }
    return NextResponse.json(attachment);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload attachment" },
      { status: 500 }
    );
  }
}
