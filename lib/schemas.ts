import { z } from "zod";

// Schemas are shared between client (React Hook Form resolver) and server (Route Handler validation),
// so the same rules apply in both places and field errors map cleanly back to the form.

/**
 * TODO(candidate): tighten this into a real http(s) media-URL validator.
 * Right now it accepts ANY non-empty string. It should reject things like "not a url",
 * "ftp://...", a bare host with no path, etc. — and produce a helpful error message.
 */
const MEDIA_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
  ".avi",
];

export const sourceUrlSchema = z
  .string()
  .trim()
  .min(1, "Source URL is required")
  .superRefine((value, ctx) => {
    if (!value) return;

    let url: URL;

    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid URL",
      });
      return;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      ctx.addIssue({
        code: "custom",
        message: "Source URL must use HTTP or HTTPS",
      });
      return;
    }

    const pathname = url.pathname.toLowerCase();

    const hasMediaExtension = MEDIA_EXTENSIONS.some((extension) =>
      pathname.endsWith(extension),
    );

    if (pathname === "/" || !hasMediaExtension) {
      ctx.addIssue({
        code: "custom",
        message:
          "Enter a media URL ending in .mp4, .mov, .m4v, .webm, .mkv, or .avi",
      });
    }
  });

export const createJobSchema = z.object({
  sourceUrl: sourceUrlSchema,
  title: z
    .string()
    .trim()
    .max(80, "Keep the title under 80 characters")
    .optional()
    .or(z.literal("")),
});
export type CreateJobInput = z.infer<typeof createJobSchema>;

export const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const startRunSchema = z.object({
  jobId: z.string().min(1, "jobId is required"),
});
