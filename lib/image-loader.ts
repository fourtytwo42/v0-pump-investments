export default function imageLoader({ src, width, quality }: { src: string; width: number; quality?: number }) {
  // If the image is from an HTTP source, try to upgrade to HTTPS
  if (src.startsWith("http://")) {
    // Try HTTPS version first
    return src.replace("http://", "https://")
  }

  // For local images or already HTTPS images, return as-is
  return src
}
