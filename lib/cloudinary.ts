import { createHash } from "crypto";

type CloudinaryUploadResult = {
  public_id: string;
  secure_url: string;
  resource_type: string;
  format?: string;
  original_filename?: string;
  bytes?: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value.replace(/^"|"$/g, "");
}

function signCloudinaryParams(params: Record<string, string>, secret: string): string {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("sha1").update(`${payload}${secret}`).digest("hex");
}

export async function uploadToCloudinary(file: File, folder: string) {
  const cloudName = requiredEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME");
  const apiKey = requiredEnv("NEXT_PUBLIC_CLOUDINARY_API_KEY");
  const apiSecret = requiredEnv("CLOUDINARY_API_SECRET");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const params = { folder, timestamp };
  const formData = new FormData();
  formData.set("file", file);
  formData.set("api_key", apiKey);
  formData.set("timestamp", timestamp);
  formData.set("folder", folder);
  formData.set("signature", signCloudinaryParams(params, apiSecret));

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
    method: "POST",
    body: formData,
  });
  const data = (await response.json().catch(() => null)) as
    | (CloudinaryUploadResult & { error?: { message?: string } })
    | null;
  if (!response.ok || !data) {
    throw new Error(data?.error?.message ?? "Cloudinary upload failed");
  }
  return data;
}

export async function deleteFromCloudinary(publicId: string, resourceType = "image") {
  const cloudName = requiredEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME");
  const apiKey = requiredEnv("NEXT_PUBLIC_CLOUDINARY_API_KEY");
  const apiSecret = requiredEnv("CLOUDINARY_API_SECRET");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const params = { public_id: publicId, timestamp };
  const formData = new FormData();
  formData.set("public_id", publicId);
  formData.set("api_key", apiKey);
  formData.set("timestamp", timestamp);
  formData.set("signature", signCloudinaryParams(params, apiSecret));

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`,
    {
      method: "POST",
      body: formData,
    }
  );
  const data = (await response.json().catch(() => null)) as
    | { result?: string; error?: { message?: string } }
    | null;
  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message ?? "Cloudinary delete failed");
  }
  return data;
}
