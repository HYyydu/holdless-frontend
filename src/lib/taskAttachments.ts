import { supabase } from "@/integrations/supabase/client";

export const TASK_ATTACHMENT_BUCKET = "task-attachments";
export const TASK_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const TASK_ATTACHMENT_ALLOWED_MIME_PREFIXES = ["image/"];
export const TASK_ATTACHMENT_ALLOWED_MIME_TYPES = ["application/pdf"];

export interface TaskAttachment {
  path: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

function isAllowedFile(file: File): boolean {
  if (TASK_ATTACHMENT_ALLOWED_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix))) {
    return true;
  }
  return TASK_ATTACHMENT_ALLOWED_MIME_TYPES.includes(file.type);
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function validateTaskAttachment(file: File): string | null {
  if (file.size > TASK_ATTACHMENT_MAX_BYTES) {
    return `${file.name} is larger than 10MB.`;
  }
  if (!isAllowedFile(file)) {
    return `${file.name} must be an image or PDF file.`;
  }
  return null;
}

export async function uploadTaskAttachments(
  userId: string,
  files: File[],
): Promise<TaskAttachment[]> {
  const uploaded: TaskAttachment[] = [];
  for (const file of files) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 10);
    const cleanName = sanitizeFileName(file.name);
    const objectPath = `${userId}/${timestamp}-${random}-${cleanName}`;
    const { error } = await supabase.storage
      .from(TASK_ATTACHMENT_BUCKET)
      .upload(objectPath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });

    if (error) {
      throw new Error(error.message || `Failed to upload ${file.name}`);
    }

    uploaded.push({
      path: objectPath,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      uploadedAt: new Date().toISOString(),
    });
  }
  return uploaded;
}
